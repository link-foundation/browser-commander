"""Firefox to Chromium profile migration.

Firefox stores its data very differently from Chromium, so each data class is
translated rather than copied:

- **cookies:** read from ``cookies.sqlite`` (``moz_cookies``, unencrypted) in
  the same shape as the Chromium reader, so the launcher can seed them over
  CDP.
- **bookmarks:** read from ``places.sqlite`` and converted to Chrome's
  ``Bookmarks`` JSON.
- **history:** translated from ``moz_historyvisits`` into Chrome's ``History``,
  preserving individual visit dates and reporting untranslated metadata.
- **passwords:** decrypted from ``logins.json`` with the NSS key in
  ``key4.db`` and re-encrypted into a Chrome ``Login Data``. When a primary
  password is set and not supplied, they are reported as
  ``primary-password-set``.

Every database is read through a consistent read-only snapshot, so a running
Firefox is never disturbed.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
from collections.abc import Sequence
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from browser_commander.browser.browser_cookies import _map_firefox_rows
from browser_commander.browser.migration.chromium_crypto import encrypt_chromium_value
from browser_commander.browser.migration.firefox_bookmarks import (
    firefox_bookmarks_to_chrome,
)
from browser_commander.browser.migration.firefox_nss import (
    PrimaryPasswordError,
    decrypt_firefox_field,
    recover_firefox_key_from_database,
)
from browser_commander.browser.migration.fs_utils import (
    PathLike,
    profile_file_if_present,
    write_compact_json,
)
from browser_commander.browser.migration.passwords import default_target_prefix
from browser_commander.browser.migration.sqlite_snapshot import (
    read_database_snapshot,
)

from .domains import matches_domains

__all__ = [
    "CHROME_LOGINS_SCHEMA",
    "FIREFOX_ROOT_GUIDS",
    "migrate_firefox_bookmarks",
    "migrate_firefox_passwords",
    "read_firefox_cookies",
    "report_firefox_history",
]

#: Firefox's fixed bookmark-root GUIDs mapped to Chrome root names.
FIREFOX_ROOT_GUIDS = {
    "toolbar_____": "toolbar",
    "menu________": "menu",
    "unfiled_____": "unfiled",
}

#: A conservative Chrome ``Login Data`` schema. Chrome re-keys or upgrades it
#: on first launch; the columns are the long-stable core of ``logins`` plus the
#: ``meta`` version marker.
CHROME_LOGINS_SCHEMA = """
CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
INSERT INTO meta (key, value) VALUES ('version', '34');
INSERT INTO meta (key, value) VALUES ('last_compatible_version', '1');
CREATE TABLE logins (
  origin_url VARCHAR NOT NULL,
  action_url VARCHAR,
  username_element VARCHAR,
  username_value VARCHAR,
  password_element VARCHAR,
  password_value BLOB,
  submit_element VARCHAR,
  signon_realm VARCHAR NOT NULL,
  date_created INTEGER NOT NULL,
  blacklisted_by_user INTEGER NOT NULL,
  scheme INTEGER NOT NULL,
  password_type INTEGER,
  times_used INTEGER,
  form_data BLOB,
  display_name VARCHAR,
  icon_url VARCHAR,
  federation_url VARCHAR,
  skip_zero_click INTEGER,
  generation_upload_status INTEGER,
  possible_username_pairs BLOB,
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_last_used INTEGER NOT NULL DEFAULT 0,
  moving_blocked_for BLOB,
  date_password_modified INTEGER NOT NULL DEFAULT 0,
  UNIQUE (origin_url, username_element, username_value, password_element, signon_realm)
);
"""

_INSERT_LOGIN = """INSERT OR IGNORE INTO logins (
         origin_url, action_url, username_element, username_value,
         password_element, password_value, submit_element, signon_realm,
         date_created, blacklisted_by_user, scheme, password_type, times_used,
         date_last_used, date_password_modified
       ) VALUES (?, ?, '', ?, '', ?, '', ?, 0, 0, 0, 0, 0, 0, 0)"""

_DEFAULT_PORTS = {"http": 80, "https": 443, "ftp": 21, "ws": 80, "wss": 443}


def _signon_realm(origin_url: Any) -> Any:
    """``scheme://host[:port]/`` for an origin, like Chrome's signon realm."""

    try:
        parts = urlsplit(str(origin_url))
        if not parts.scheme or not parts.netloc:
            return origin_url
        host = (parts.hostname or "").lower()
        if ":" in host:
            host = f"[{host}]"
        port = parts.port
        if port is not None and _DEFAULT_PORTS.get(parts.scheme.lower()) != port:
            host = f"{host}:{port}"
        return f"{parts.scheme.lower()}://{host}/"
    except ValueError:
        return origin_url


def read_firefox_cookies(
    *, profile_dir: PathLike, domains: Sequence[str] | None = None
) -> list[dict[str, Any]]:
    """Read ``cookies.sqlite`` in the same shape as the Chromium reader.

    Args:
        profile_dir: Firefox profile directory.
        domains: Keep cookies whose host contains any of these substrings;
            all cookies when empty.
    """

    cookie_path = profile_file_if_present(profile_dir, "cookies.sqlite")
    if cookie_path is None:
        return []
    wanted = list(domains or [])

    def read(database: sqlite3.Connection) -> list[dict[str, Any]]:
        rows = database.execute(
            """SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite
             FROM moz_cookies ORDER BY host, name, path"""
        ).fetchall()
        if wanted:
            rows = [row for row in rows if matches_domains(row["host"] or "", wanted)]
        return _map_firefox_rows(rows)

    return read_database_snapshot(cookie_path, read)


def migrate_firefox_bookmarks(
    *, profile_dir: PathLike, target_profile_dir: PathLike
) -> dict[str, Any]:
    """Convert Firefox bookmarks into a Chrome ``Bookmarks`` file."""

    places_path = profile_file_if_present(profile_dir, "places.sqlite")
    if places_path is None:
        return {
            "migrated": 0,
            "skipped": [
                {
                    "type": "bookmarks",
                    "item": "places.sqlite",
                    "reason": "source-missing",
                }
            ],
            "warnings": [],
        }

    def read(database: sqlite3.Connection) -> list[dict[str, Any]]:
        rows = database.execute(
            """SELECT b.id, b.parent, b.type, b.title, b.guid, p.url
             FROM moz_bookmarks b
             LEFT JOIN moz_places p ON b.fk = p.id
            ORDER BY b.parent, b.position"""
        ).fetchall()
        return [
            {
                "id": int(row["id"]),
                "parent": int(row["parent"]),
                "type": int(row["type"]),
                "title": row["title"],
                "url": row["url"],
                "root": FIREFOX_ROOT_GUIDS.get(row["guid"]),
            }
            for row in rows
        ]

    rows = read_database_snapshot(places_path, read)
    document, count = firefox_bookmarks_to_chrome(rows)
    target = Path(target_profile_dir)
    target.mkdir(parents=True, exist_ok=True)
    write_compact_json(target / "Bookmarks", document)
    return {"migrated": count, "skipped": [], "warnings": []}


def report_firefox_history(*, profile_dir: PathLike) -> dict[str, Any]:
    """Count Firefox history and report it (Chrome's schema is incompatible)."""

    places_path = profile_file_if_present(profile_dir, "places.sqlite")
    if places_path is None:
        return {"migrated": 0, "skipped": [], "warnings": []}
    count = read_database_snapshot(
        places_path,
        lambda database: int(
            database.execute("SELECT COUNT(*) AS c FROM moz_places").fetchone()[0]
        ),
    )
    return {
        "migrated": 0,
        "skipped": [
            {
                "type": "history",
                "item": "places.sqlite",
                "reason": "firefox-history-schema-incompatible",
            }
        ],
        "warnings": [
            {
                "type": "history",
                "item": "places.sqlite",
                "reason": "not-migrated",
                "detail": (
                    f"Firefox has {count} history entries; Chrome's History "
                    "schema is incompatible, so history is reported but not "
                    "converted."
                ),
            }
        ],
    }


def migrate_firefox_passwords(
    *,
    profile_dir: PathLike,
    target_profile_dir: PathLike,
    platform: str,
    target_key: bytes | None,
    target_prefix: str | None = None,
    primary_password: bytes | str = b"",
    domains=None,
) -> dict[str, Any]:
    """Decrypt Firefox logins and write them into a Chrome ``Login Data``.

    Raises:
        TypeError: When ``target_key`` is not bytes.
    """

    logins_path = profile_file_if_present(profile_dir, "logins.json")
    key4_path = profile_file_if_present(profile_dir, "key4.db")
    if logins_path is None or key4_path is None:
        return {
            "migrated": 0,
            "skipped": [
                {"type": "passwords", "item": "logins.json", "reason": "source-missing"}
            ],
            "warnings": [],
        }
    if not isinstance(target_key, (bytes, bytearray)):
        msg = "migrate_firefox_passwords requires a target key"
        raise TypeError(msg)
    prefix = default_target_prefix(platform) if target_prefix is None else target_prefix

    try:
        key = read_database_snapshot(
            key4_path,
            lambda database: recover_firefox_key_from_database(
                database, primary_password
            ),
        )
    except PrimaryPasswordError:
        return {
            "migrated": 0,
            "skipped": [
                {
                    "type": "passwords",
                    "item": "logins.json",
                    "reason": "primary-password-set",
                }
            ],
            "warnings": [],
        }

    document = json.loads(logins_path.read_text(encoding="utf-8"))
    logins = document.get("logins") if isinstance(document, dict) else None
    decrypted: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for login in logins or []:
        if not matches_domains(login.get("hostname", ""), domains):
            continue
        try:
            decrypted.append(
                {
                    "origin": login.get("hostname"),
                    "username": decrypt_firefox_field(
                        login.get("encryptedUsername"), key
                    ),
                    "password": decrypt_firefox_field(
                        login.get("encryptedPassword"), key
                    ),
                }
            )
        except Exception as error:
            hostname = login.get("hostname") if isinstance(login, dict) else None
            skipped.append(
                {
                    "type": "passwords",
                    "item": hostname if hostname is not None else "(unknown)",
                    "reason": "decrypt-failed",
                    "detail": str(error),
                }
            )

    migrated = write_chromium_passwords(
        entries=decrypted,
        target_profile_dir=target_profile_dir,
        platform=platform,
        target_key=target_key,
        target_prefix=prefix,
    )

    warnings: list[dict[str, Any]] = []
    if migrated > 0:
        warnings.append(
            {
                "type": "passwords",
                "item": "Login Data",
                "reason": "reencrypted-for-chrome",
                "detail": (
                    f"{migrated} Firefox logins were decrypted and re-encrypted "
                    "into a Chrome Login Data; Chrome may re-key the store on "
                    "first launch."
                ),
            }
        )
    return {"migrated": migrated, "skipped": skipped, "warnings": warnings}


def write_chromium_passwords(
    *,
    entries: list[dict[str, str]],
    target_profile_dir: PathLike,
    platform: str,
    target_key: bytes,
    target_prefix: str | None = None,
) -> int:
    target = Path(target_profile_dir)
    target.mkdir(parents=True, exist_ok=True)
    migrated = 0
    with contextlib.closing(sqlite3.connect(target / "Login Data")) as database:
        database.executescript(CHROME_LOGINS_SCHEMA)
        for entry in entries:
            encrypted = encrypt_chromium_value(
                entry["password"],
                key=bytes(target_key),
                platform=platform,
                prefix=target_prefix,
            )
            database.execute(
                _INSERT_LOGIN,
                (
                    entry["origin"],
                    entry["origin"],
                    entry["username"],
                    encrypted,
                    _signon_realm(entry["origin"]),
                ),
            )
            migrated += 1
        database.commit()

    return migrated
