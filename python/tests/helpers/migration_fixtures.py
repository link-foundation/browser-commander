"""Profile fixtures for the profile-migration tests.

Mirrors ``js/tests/helpers/migration-fixtures.js`` and
``js/tests/fixtures/firefox-nss-fixtures.mjs``: every migration suite moves
data from a source profile into a target one and checks the same report shape,
and the Firefox suites need the same ``cookies.sqlite``, ``places.sqlite``,
``key4.db`` and ``logins.json`` files, so they are built here once.

The NSS builders produce the exact structures the production decryptor parses
(PBES2-wrapped keys, DER-wrapped 3DES login fields). The encryptor here and the
decryptor under test share the same algorithm, so a green test proves the
parser and the crypto agree.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib
import json
import os
import sqlite3
from collections.abc import Callable, Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import hashes, padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from browser_commander.browser.browser_cookie_crypto import decrypt_chromium_cookie
from browser_commander.browser.migration.chromium_crypto import encrypt_chromium_value

__all__ = [
    "LOGIN_CKA_ID",
    "assert_nothing_migrated",
    "assert_source_unchanged",
    "build_key4_database",
    "build_logins_json",
    "encode_login_field",
    "encrypt_chromium_cookie_value",
    "encrypted_login",
    "migrate_between",
    "read_migrated_logins",
    "read_profile_json",
    "write_chromium_cookies",
    "write_chromium_extension",
    "write_chromium_history",
    "write_firefox_cookies",
    "write_firefox_logins",
    "write_firefox_places",
    "write_local_state",
    "write_login_data",
    "write_profile_json",
]

# ---------------------------------------------------------------------------
# Generic report and file helpers
# ---------------------------------------------------------------------------


def migrate_between(
    migrate: Callable[..., dict[str, Any]],
    source: Path,
    target: Path,
    **options: Any,
) -> dict[str, Any]:
    """Run a Chromium migration step from one profile directory into another."""

    return migrate(source_profile_dir=source, target_profile_dir=target, **options)


def assert_nothing_migrated(report: Mapping[str, Any], reason: str) -> None:
    """Assert that a step migrated nothing, and that ``reason`` is why."""

    assert report["migrated"] == 0
    assert report["skipped"][0]["reason"] == reason


def assert_source_unchanged(file_path: Path, action: Callable[[], Any]) -> Any:
    """Assert that ``action`` leaves ``file_path`` untouched.

    Migration only ever reads a snapshot of the source, so neither its
    modification time nor its bytes may change.

    Returns:
        Whatever ``action`` returned.
    """

    before_stat = file_path.stat().st_mtime_ns
    before_bytes = file_path.read_bytes()
    result = action()
    assert file_path.stat().st_mtime_ns == before_stat
    assert file_path.read_bytes() == before_bytes
    return result


def write_profile_json(profile_dir: Path, name: str, value: Any) -> Path:
    """Write a JSON profile file such as ``Bookmarks`` or ``Preferences``."""

    path = profile_dir / name
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def read_profile_json(profile_dir: Path, name: str) -> Any:
    """Read and parse a JSON profile file a migration wrote."""

    return json.loads((profile_dir / name).read_text(encoding="utf-8"))


def _execute_script(
    database_path: Path,
    script: str,
    statement: str | None = None,
    rows: Iterable[Sequence[Any]] = (),
) -> None:
    """Create ``database_path``, run ``script`` and insert ``rows``."""

    with contextlib.closing(sqlite3.connect(database_path)) as database:
        database.executescript(script)
        if statement is not None:
            database.executemany(statement, list(rows))
        database.commit()


# ---------------------------------------------------------------------------
# Chromium profile fixtures
# ---------------------------------------------------------------------------


def write_chromium_history(profile_dir: Path, url_count: int) -> Path:
    """Write a Chromium ``History`` database with ``url_count`` visited URLs."""

    history_path = profile_dir / "History"
    _execute_script(
        history_path,
        "CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT);",
        "INSERT INTO urls (url, title) VALUES (?, ?)",
        [(f"https://example.com/{i}", f"Page {i}") for i in range(url_count)],
    )
    return history_path


def write_login_data(profile_dir: Path, rows: Iterable[Mapping[str, Any]]) -> Path:
    """Write a minimal Chromium ``Login Data`` holding ``rows``.

    Each row has ``origin_url``, ``username`` and ``password_value`` (bytes).
    """

    login_path = profile_dir / "Login Data"
    _execute_script(
        login_path,
        "CREATE TABLE logins "
        "(origin_url TEXT, username_value TEXT, password_value BLOB);",
        "INSERT INTO logins (origin_url, username_value, password_value) "
        "VALUES (?, ?, ?)",
        [(row["origin_url"], row["username"], row["password_value"]) for row in rows],
    )
    return login_path


def encrypted_login(
    *,
    origin_url: str,
    username: str,
    plaintext: str,
    key: bytes,
    prefix: str,
    platform: str = "linux",
) -> dict[str, Any]:
    """A source login whose password is encrypted with the source key."""

    return {
        "origin_url": origin_url,
        "username": username,
        "password_value": encrypt_chromium_value(
            plaintext, key=key, platform=platform, prefix=prefix
        ),
    }


def write_chromium_extension(
    profile_dir: Path, extension_id: str, version: str
) -> Path:
    """Write ``Extensions/<id>/<version>/manifest.json`` into a profile."""

    directory = profile_dir / "Extensions" / extension_id / version
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "manifest.json").write_text(
        json.dumps({"name": extension_id, "version": version, "manifest_version": 3}),
        encoding="utf-8",
    )
    return directory


def write_local_state(user_data_dir: Path, value: Mapping[str, Any]) -> Path:
    """Write a Chromium ``Local State`` document into a user data dir."""

    user_data_dir.mkdir(parents=True, exist_ok=True)
    path = user_data_dir / "Local State"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def write_chromium_cookies(
    profile_dir: Path,
    rows: Iterable[Mapping[str, Any]],
    *,
    database_version: int = 24,
) -> Path:
    """Write a Chromium ``Network/Cookies`` database holding ``rows``.

    Each row has ``host`` and ``name`` plus optional ``value``,
    ``encrypted_value``, ``path``, ``expires_utc``, ``secure``, ``http_only``
    and ``same_site``.
    """

    cookie_path = profile_dir / "Network" / "Cookies"
    cookie_path.parent.mkdir(parents=True, exist_ok=True)
    _execute_script(
        cookie_path,
        f"""
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
        INSERT INTO meta (key, value) VALUES ('version', '{int(database_version)}');
        CREATE TABLE cookies (
            host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB,
            path TEXT, expires_utc INTEGER, is_secure INTEGER,
            is_httponly INTEGER, samesite INTEGER
        );
        """,
        "INSERT INTO cookies (host_key, name, value, encrypted_value, path, "
        "expires_utc, is_secure, is_httponly, samesite) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                row["host"],
                row["name"],
                row.get("value", ""),
                row.get("encrypted_value", b""),
                row.get("path", "/"),
                row.get("expires_utc", 0),
                int(bool(row.get("secure", False))),
                int(bool(row.get("http_only", False))),
                row.get("same_site", -1),
            )
            for row in rows
        ],
    )
    return cookie_path


def encrypt_chromium_cookie_value(
    *, host: str, value: str, key: bytes, prefix: str = "v10"
) -> bytes:
    """Encrypt a Linux/macOS cookie value with its version-24 domain hash."""

    plaintext = hashlib.sha256(host.encode()).digest() + value.encode()
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plaintext) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(b" " * 16)).encryptor()
    return prefix.encode("ascii") + encryptor.update(padded) + encryptor.finalize()


def read_migrated_logins(
    target_profile_dir: Path, target_key: bytes, platform: str = "linux"
) -> list[dict[str, str]]:
    """Read back the logins a migration wrote, decrypted with the target key.

    Returns:
        ``{"origin", "username", "password"}`` entries sorted by origin.
    """

    uri = f"{(target_profile_dir / 'Login Data').resolve().as_uri()}?mode=ro"
    with contextlib.closing(sqlite3.connect(uri, uri=True)) as database:
        rows = database.execute(
            "SELECT origin_url, username_value, password_value FROM logins "
            "ORDER BY origin_url"
        ).fetchall()
    return [
        {
            "origin": origin,
            "username": username,
            "password": decrypt_chromium_cookie(
                bytes(password_value),
                host=urlsplit(origin).hostname or "",
                database_version=0,
                platform=platform,
                key=target_key,
            ),
        }
        for origin, username, password_value in rows
    ]


# ---------------------------------------------------------------------------
# Firefox profile fixtures
# ---------------------------------------------------------------------------


def write_firefox_cookies(profile_dir: Path, rows: Iterable[Mapping[str, Any]]) -> Path:
    """Write a Firefox ``cookies.sqlite`` holding ``rows``.

    Each row has ``name``, ``value`` and ``host`` plus optional ``path``,
    ``expiry``, ``secure``, ``http_only`` and ``same_site``.
    """

    cookie_path = profile_dir / "cookies.sqlite"
    _execute_script(
        cookie_path,
        """
        CREATE TABLE moz_cookies (
            name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,
            isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER
        );
        """,
        "INSERT INTO moz_cookies (name, value, host, path, expiry, isSecure, "
        "isHttpOnly, sameSite) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                row["name"],
                row["value"],
                row["host"],
                row.get("path", "/"),
                row.get("expiry", 0),
                1 if row.get("secure") else 0,
                1 if row.get("http_only") else 0,
                row.get("same_site", 0),
            )
            for row in rows
        ],
    )
    return cookie_path


def write_firefox_profile(
    home: Path,
    rows: Iterable[Mapping[str, Any]],
    *,
    root: str = ".mozilla/firefox",
    name: str = "default-release",
) -> Path:
    """Write a Linux Firefox-family install under ``home`` with one profile.

    The profile is listed as the default in ``profiles.ini`` and its
    ``cookies.sqlite`` holds ``rows``. ``root`` is the install root relative to
    ``home`` (a fork such as LibreWolf uses its own); returns the profile dir.
    """

    root_path = home.joinpath(*root.split("/"))
    profile_name = f"xyz.{name}"
    profile_path = root_path / profile_name
    profile_path.mkdir(parents=True)
    (root_path / "profiles.ini").write_text(
        f"[Profile0]\nName={name}\nIsRelative=1\nPath={profile_name}\nDefault=1\n",
        encoding="utf-8",
    )
    write_firefox_cookies(profile_path, rows)
    return profile_path


def write_firefox_places(profile_dir: Path, *, with_menu_bookmark: bool = True) -> Path:
    """Write a Firefox ``places.sqlite`` with a toolbar and a menu bookmark.

    Unless ``with_menu_bookmark`` is false, a bookmarks-menu entry is added
    too. Each bookmark has its own ``moz_places`` row, so the history count
    equals the bookmark count.
    """

    places_path = profile_dir / "places.sqlite"
    bookmarks: list[tuple[Any, ...]] = [
        (1, 2, None, 0, 0, "", "root________"),
        (3, 2, None, 1, 0, "Bookmarks Toolbar", "toolbar_____"),
        (100, 1, 10, 3, 0, "Toolbar Site", "aaaaaaaaaaaa"),
    ]
    places: list[tuple[Any, ...]] = [(10, "https://toolbar.example/")]
    if with_menu_bookmark:
        bookmarks.append((2, 2, None, 1, 1, "Bookmarks Menu", "menu________"))
        places.append((11, "https://menu.example/"))
        bookmarks.append((101, 1, 11, 2, 0, "Menu Site", "bbbbbbbbbbbb"))
    _execute_script(
        places_path,
        """
        CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
        CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER,
          fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT);
        """,
        "INSERT INTO moz_places (id, url) VALUES (?, ?)",
        places,
    )
    with contextlib.closing(sqlite3.connect(places_path)) as database:
        database.executemany(
            "INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, guid) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            bookmarks,
        )
        database.commit()
    return places_path


def write_firefox_logins(
    profile_dir: Path,
    *,
    entries: Sequence[Mapping[str, str]],
    primary_password: bytes = b"",
) -> dict[str, Any]:
    """Write a Firefox ``key4.db`` and a ``logins.json`` encrypted with its key.

    Returns:
        ``{"key4_path", "login_key", "primary_password"}``.
    """

    key4_path, login_key, password = build_key4_database(
        profile_dir, primary_password=primary_password
    )
    (profile_dir / "logins.json").write_text(
        build_logins_json(key=login_key, entries=entries), encoding="utf-8"
    )
    return {
        "key4_path": key4_path,
        "login_key": login_key,
        "primary_password": password,
    }


# ---------------------------------------------------------------------------
# NSS (key4.db / logins.json) builders
# ---------------------------------------------------------------------------

_OID_BYTES = {
    "PBES2": bytes([0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x05, 0x0D]),
    "PBKDF2": bytes([0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x05, 0x0C]),
    "HMAC_SHA256": bytes([0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x02, 0x09]),
    "AES_256_CBC": bytes([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x01, 0x2A]),
    "DES_EDE3_CBC": bytes([0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x03, 0x07]),
}

#: The CKA_ID NSS stores next to the login key and in every login field.
LOGIN_CKA_ID = bytes.fromhex("f8000000000000000000000000000001")


def _der_length(length: int) -> bytes:
    if length < 0x80:
        return bytes([length])
    encoded = length.to_bytes((length.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(encoded)]) + encoded


def _der_element(tag: int, content: bytes) -> bytes:
    return bytes([tag]) + _der_length(len(content)) + content


def _der_sequence(*parts: bytes) -> bytes:
    return _der_element(0x30, b"".join(parts))


def _der_octet(content: bytes) -> bytes:
    return _der_element(0x04, content)


def _der_oid(content: bytes) -> bytes:
    return _der_element(0x06, content)


def _der_integer(number: int) -> bytes:
    if number == 0:
        encoded = b"\x00"
    else:
        encoded = number.to_bytes((number.bit_length() + 7) // 8, "big")
        if encoded[0] & 0x80:
            encoded = b"\x00" + encoded
    return _der_element(0x02, encoded)


def _pbes2_key(
    global_salt: bytes, entry_salt: bytes, iterations: int, primary_password: bytes
) -> bytes:
    """Mirror the NSS key4.db scheme so fixtures decrypt like a real profile."""

    # This fixture mirrors Firefox's fixed NSS on-disk derivation:
    # SHA-1(globalSalt + primaryPassword) is then fed to PBKDF2-HMAC-SHA256.
    # A stronger hash here would make synthetic key4.db unlike a real one.
    password_hash = hashlib.sha1(global_salt + primary_password).digest()
    return PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32, salt=entry_salt, iterations=iterations
    ).derive(password_hash)


def _encode_pbes2_blob(
    *,
    global_salt: bytes,
    entry_salt: bytes,
    iterations: int,
    iv14: bytes,
    plaintext: bytes,
    primary_password: bytes,
) -> bytes:
    """Encrypt ``plaintext`` into a DER PBES2 blob as ``key4.db`` stores it."""

    key = _pbes2_key(global_salt, entry_salt, iterations, primary_password)
    padder = padding.PKCS7(128).padder()
    padded = padder.update(plaintext) + padder.finalize()
    encryptor = Cipher(algorithms.AES(key), modes.CBC(b"\x04\x0e" + iv14)).encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()
    kdf = _der_sequence(
        _der_oid(_OID_BYTES["PBKDF2"]),
        _der_sequence(
            _der_octet(entry_salt),
            _der_integer(iterations),
            _der_integer(32),
            _der_sequence(_der_oid(_OID_BYTES["HMAC_SHA256"])),
        ),
    )
    enc = _der_sequence(_der_oid(_OID_BYTES["AES_256_CBC"]), _der_octet(iv14))
    algorithm_id = _der_sequence(_der_oid(_OID_BYTES["PBES2"]), _der_sequence(kdf, enc))
    return _der_sequence(algorithm_id, _der_octet(ciphertext))


def build_key4_database(
    directory: Path,
    primary_password: bytes = b"",
    iterations: int = 100,
) -> tuple[Path, bytes, bytes]:
    """Build a Firefox ``key4.db`` with a PBES2-wrapped 3DES login key.

    Returns:
        ``(key4_path, login_key, primary_password)``.
    """

    global_salt = os.urandom(16)
    login_key = os.urandom(24)
    check_blob = _encode_pbes2_blob(
        global_salt=global_salt,
        entry_salt=os.urandom(16),
        iterations=iterations,
        iv14=os.urandom(14),
        # PKCS#7 adds a full block on top of the NSS "\x02\x02" padding, which
        # is what the JavaScript fixture produces with Node's auto padding.
        plaintext=b"password-check\x02\x02",
        primary_password=primary_password,
    )
    key_blob = _encode_pbes2_blob(
        global_salt=global_salt,
        entry_salt=os.urandom(16),
        iterations=iterations,
        iv14=os.urandom(14),
        plaintext=login_key,
        primary_password=primary_password,
    )
    key4_path = Path(directory) / "key4.db"
    with contextlib.closing(sqlite3.connect(key4_path)) as database:
        database.executescript(
            "CREATE TABLE metadata (id TEXT PRIMARY KEY, item1 BLOB, item2 BLOB);"
            "CREATE TABLE nssPrivate (a11 BLOB, a102 BLOB);"
        )
        database.execute(
            "INSERT INTO metadata (id, item1, item2) VALUES (?, ?, ?)",
            ("password", global_salt, check_blob),
        )
        database.execute(
            "INSERT INTO nssPrivate (a11, a102) VALUES (?, ?)",
            (key_blob, LOGIN_CKA_ID),
        )
        database.commit()
    return key4_path, login_key, primary_password


def _triple_des(key: bytes) -> Any:
    """Return Firefox's legacy login-field cipher for the test fixture.

    Production only decrypts these fields, then re-encrypts for the target
    profile. This fixture must write 3DES-CBC to match real ``logins.json``;
    an AES fixture would not exercise NSS migration.
    """

    try:
        module = importlib.import_module(
            "cryptography.hazmat.decrepit.ciphers.algorithms"
        )
    except ImportError:  # cryptography < 43
        module = algorithms
    return module.TripleDES(key)


def encode_login_field(*, key: bytes, plaintext: str) -> str:
    """Encode one NSS login field as base64, exactly like ``logins.json``."""

    iv = os.urandom(8)
    padder = padding.PKCS7(64).padder()
    padded = padder.update(plaintext.encode("utf-8")) + padder.finalize()
    encryptor = Cipher(_triple_des(key), modes.CBC(iv)).encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()
    blob = _der_sequence(
        _der_octet(LOGIN_CKA_ID),
        _der_sequence(_der_oid(_OID_BYTES["DES_EDE3_CBC"]), _der_octet(iv)),
        _der_octet(ciphertext),
    )
    return base64.b64encode(blob).decode("ascii")


def build_logins_json(*, key: bytes, entries: Sequence[Mapping[str, str]]) -> str:
    """Build a ``logins.json`` document from plaintext credentials."""

    return json.dumps(
        {
            "nextId": len(entries) + 1,
            "logins": [
                {
                    "id": index + 1,
                    "hostname": entry["hostname"],
                    "encryptedUsername": encode_login_field(
                        key=key, plaintext=entry["username"]
                    ),
                    "encryptedPassword": encode_login_field(
                        key=key, plaintext=entry["password"]
                    ),
                    "guid": f"{{fixture-{index}}}",
                }
                for index, entry in enumerate(entries)
            ],
        }
    )
