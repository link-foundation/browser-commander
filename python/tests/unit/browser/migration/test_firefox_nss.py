"""Tests for the Firefox NSS key recovery (mirrors firefox-nss.test.js)."""

from __future__ import annotations

import contextlib
import sqlite3
from typing import TYPE_CHECKING

import pytest

from browser_commander.browser.migration.firefox_der import (
    decode_der_element,
    decode_der_sequence,
    oid_to_string,
)
from browser_commander.browser.migration.firefox_nss import (
    PrimaryPasswordError,
    decrypt_firefox_field,
    recover_firefox_key,
    recover_firefox_key_from_database,
)
from tests.helpers.migration_fixtures import build_key4_database, encode_login_field

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


@contextlib.contextmanager
def _open_read_only(database_path: Path) -> Iterator[sqlite3.Connection]:
    """Open ``database_path`` read-only, as the migration does."""

    uri = f"{database_path.resolve().as_uri()}?mode=ro"
    with contextlib.closing(sqlite3.connect(uri, uri=True)) as database:
        yield database


class TestFirefoxDer:
    def test_decodes_a_nested_sequence_and_oid(self) -> None:
        # SEQUENCE { OID 1.2.840.113549.1.5.13, OCTET STRING 0x01 0x02 }
        oid = bytes([0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x05, 0x0D])
        octet = bytes([0x04, 0x02, 0x01, 0x02])
        sequence = bytes([0x30, len(oid) + len(octet)]) + oid + octet

        decoded = decode_der_element(sequence)
        oid_element, octet_element = decode_der_sequence(decoded.content)

        assert oid_to_string(oid_element.content) == "1.2.840.113549.1.5.13"
        assert list(octet_element.content) == [0x01, 0x02]
        assert decoded.children is not None
        assert len(decoded.children) == 2

    def test_decodes_long_form_lengths(self) -> None:
        payload = bytes(200)
        element = decode_der_element(bytes([0x04, 0x81, 200]) + payload)
        assert element.length == 200
        assert element.header == 3
        assert element.content == payload

    def test_rejects_truncated_elements(self) -> None:
        with pytest.raises(ValueError, match="truncated"):
            decode_der_element(bytes([0x04, 0x05, 0x01]))


class TestRecoverFirefoxKeyFromDatabase:
    def test_recovers_the_3des_login_key_via_pbes2_with_no_primary_password(
        self, tmp_path: Path
    ) -> None:
        key4_path, login_key, _ = build_key4_database(tmp_path)
        with _open_read_only(key4_path) as database:
            assert recover_firefox_key_from_database(database) == login_key

    def test_round_trips_a_login_field_decryption(self, tmp_path: Path) -> None:
        key4_path, _, _ = build_key4_database(tmp_path)
        with _open_read_only(key4_path) as database:
            recovered = recover_firefox_key_from_database(database)
        encoded = encode_login_field(key=recovered, plaintext="super-secret")
        assert decrypt_firefox_field(encoded, recovered) == "super-secret"

    def test_throws_primary_password_error_when_the_wrong_password_is_supplied(
        self, tmp_path: Path
    ) -> None:
        key4_path, _, _ = build_key4_database(
            tmp_path, primary_password=b"correct horse"
        )
        with (
            _open_read_only(key4_path) as database,
            pytest.raises(PrimaryPasswordError),
        ):
            recover_firefox_key_from_database(database, b"wrong")

    def test_throws_primary_password_error_when_none_is_supplied(
        self, tmp_path: Path
    ) -> None:
        key4_path, _, _ = build_key4_database(
            tmp_path, primary_password=b"correct horse"
        )
        with (
            _open_read_only(key4_path) as database,
            pytest.raises(PrimaryPasswordError),
        ):
            recover_firefox_key_from_database(database)

    def test_recovers_with_the_correct_primary_password(self, tmp_path: Path) -> None:
        key4_path, login_key, primary_password = build_key4_database(
            tmp_path, primary_password=b"correct horse"
        )
        with _open_read_only(key4_path) as database:
            assert (
                recover_firefox_key_from_database(database, primary_password)
                == login_key
            )
            # A str password is encoded as UTF-8.
            assert (
                recover_firefox_key_from_database(database, "correct horse")
                == login_key
            )

    def test_reports_a_helpful_error_when_metadata_is_missing(
        self, tmp_path: Path
    ) -> None:
        key4_path = tmp_path / "key4.db"
        with contextlib.closing(sqlite3.connect(key4_path)) as database:
            database.execute("CREATE TABLE metadata (id TEXT, item1 BLOB, item2 BLOB)")
            database.commit()
        (tmp_path / "marker").write_text("x")
        with (
            _open_read_only(key4_path) as database,
            pytest.raises(ValueError, match="no password metadata"),
        ):
            recover_firefox_key_from_database(database)


class TestRecoverFirefoxKey:
    def test_recovers_through_a_read_only_snapshot(self, tmp_path: Path) -> None:
        key4_path, login_key, _ = build_key4_database(tmp_path, iterations=10)
        before = key4_path.read_bytes()
        assert recover_firefox_key(key4_path) == login_key
        assert key4_path.read_bytes() == before
