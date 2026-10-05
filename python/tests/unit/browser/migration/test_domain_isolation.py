import contextlib
import os
import sqlite3
from pathlib import Path

import pytest

from browser_commander.browser.browser_cookie_crypto import (
    decrypt_chromium_cookie,
    derive_chromium_cookie_key,
)
from browser_commander.browser.migration.chromium_crypto import encrypt_chromium_value
from browser_commander.browser.migration.history import migrate_history
from browser_commander.browser.migration.passwords import migrate_passwords


@pytest.mark.parametrize("domains", [["github.com"], []])
def test_password_metadata_is_filtered_and_notes_use_target_key(tmp_path, domains):
    source = tmp_path / "source"
    source.mkdir()
    target = tmp_path / "target"
    source_key, target_key = os.urandom(16), os.urandom(16)
    source_path = source / "Login Data"
    source_note = encrypt_chromium_value(
        "private note ☃", key=source_key, platform="linux", prefix="v11"
    )
    with contextlib.closing(sqlite3.connect(source_path)) as db:
        db.executescript(
            (
                Path(__file__).resolve().parents[5]
                / "tests/fixtures/password-domain-isolation.sql"
            ).read_text()
        )
        db.execute(
            "UPDATE logins SET password_value=? WHERE id IN (7,8)",
            (
                encrypt_chromium_value(
                    "password", key=source_key, platform="linux", prefix="v11"
                ),
            ),
        )
        db.execute(
            "UPDATE password_notes SET value=? WHERE id IN (70,71,72)", (source_note,)
        )
        db.commit()
    original = source_path.read_bytes()
    report = migrate_passwords(
        source_profile_dir=source,
        target_profile_dir=target,
        domains=domains,
        platform="linux",
        resolve_source_key=lambda _prefix: source_key,
        target_key=target_key,
    )
    filtered = bool(domains)
    assert report["migrated"] == (1 if filtered else 2)
    with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
        assert db.execute("SELECT parent_id FROM insecure_credentials").fetchall() == (
            [(7,)] if filtered else [(7,), (8,)]
        )
        assert db.execute("SELECT origin_domain FROM stats").fetchall() == (
            [("https://github.com",)]
            if filtered
            else [("https://github.com",), ("https://notgithub.com",)]
        )
        notes = db.execute(
            "SELECT id,value,date_created,confidential FROM password_notes"
        ).fetchall()
        assert len(notes) == (1 if filtered else 2)
        assert (notes[0][0], notes[0][2], notes[0][3]) == (70, 123, 1)
        for note in notes:
            assert (
                decrypt_chromium_cookie(
                    note[1],
                    host="",
                    database_version=0,
                    platform="linux",
                    key=target_key,
                )
                == "private note ☃"
            )
        for table in [
            "sync_entities_metadata",
            "sync_model_metadata",
            "future_password_metadata",
        ]:
            preserved = table == "future_password_metadata" and not filtered
            assert db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == int(
                preserved
            )
            assert any(warning["item"] == table for warning in report["warnings"]) == (
                not preserved
            )
    assert any(
        entry["item"] == "password_notes/73" and entry["reason"] == "app-bound-v20"
        for entry in report["skipped"]
    )
    target_bytes = (target / "Login Data").read_bytes()
    assert b"unrelated-sync-marker" not in target_bytes
    assert (b"unrelated-future-marker" in target_bytes) == (not filtered)
    assert source_note not in target_bytes
    assert source_path.read_bytes() == original


def test_history_domain_isolation_preserves_matching_visits(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    target = tmp_path / "target"
    with contextlib.closing(sqlite3.connect(source / "History")) as db:
        db.executescript(
            (
                Path(__file__).resolve().parents[5]
                / "tests/fixtures/history-domain-isolation.sql"
            ).read_text()
        )
    migrate_history(
        source_profile_dir=source, target_profile_dir=target, domains=["github.com"]
    )
    with contextlib.closing(sqlite3.connect(target / "History")) as db:
        assert db.execute("SELECT count(*) FROM urls").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM visits").fetchone()[0] == 1
        for table in [
            "content_annotations",
            "context_annotations",
            "segment_usage",
            "downloads",
            "downloads_url_chains",
            "downloads_slices",
        ]:
            assert db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 1, table


def test_password_domain_isolation_removes_undecryptable_values(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    target = tmp_path / "target"
    key = derive_chromium_cookie_key("source", "linux")
    with contextlib.closing(sqlite3.connect(source / "Login Data")) as db:
        db.execute("CREATE TABLE logins(origin_url TEXT,password_value BLOB)")
        db.executemany(
            "INSERT INTO logins VALUES (?,?)",
            [
                (
                    "https://github.com",
                    encrypt_chromium_value(
                        "secret", key=key, platform="linux", prefix="v11"
                    ),
                ),
                ("https://notgithub.com", b"v20unreadable"),
                ("https://locked.github.com", b"v20unreadable"),
            ],
        )
        db.commit()
    report = migrate_passwords(
        source_profile_dir=source,
        target_profile_dir=target,
        domains=["github.com"],
        platform="linux",
        resolve_source_key=lambda _prefix: key,
        target_key=key,
    )
    assert report["migrated"] == 1
    with contextlib.closing(sqlite3.connect(target / "Login Data")) as db:
        assert db.execute("SELECT origin_url FROM logins").fetchall() == [
            ("https://github.com",)
        ]
