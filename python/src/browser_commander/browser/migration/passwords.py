"""Migrate Chromium saved passwords by re-encrypting ``Login Data``.

The source ``Login Data`` is snapshotted and copied into the target profile,
then every ``password_value`` is decrypted with the source profile's OSCrypt
key and re-encrypted with the target profile's key. Values that cannot move
are reported per row: Windows app-bound ``v20`` values (only the browser's
elevation service can decrypt them), unknown prefixes and decryption
failures.
"""

from __future__ import annotations

import contextlib
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from browser_commander.browser.browser_cookie_crypto import decrypt_chromium_cookie
from browser_commander.browser.migration.chromium_crypto import encrypt_chromium_value
from browser_commander.browser.migration.fs_utils import PathLike
from browser_commander.browser.migration.sqlite_snapshot import (
    with_database_snapshot,
)

__all__ = ["default_target_prefix", "migrate_passwords"]


def default_target_prefix(platform: str) -> str:
    """The prefix Chromium writes on ``platform``: ``v10`` on Windows, else ``v11``."""

    return "v10" if platform == "win32" else "v11"


def _to_bytes(value: Any) -> bytes:
    if value is None:
        return b""
    if isinstance(value, str):
        return value.encode("utf-8")
    return bytes(value)


def _host_from_origin(origin_url: Any) -> str:
    """The origin's host name, or the origin itself when it is not a URL."""

    if origin_url is None:
        return ""
    try:
        parts = urlsplit(str(origin_url))
        if not parts.scheme:
            return str(origin_url)
        return parts.hostname or ""
    except ValueError:
        return str(origin_url)


def _skip(origin_url: Any, reason: str, detail: str | None = None) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "type": "passwords",
        "item": origin_url if origin_url is not None else "(unknown)",
        "reason": reason,
    }
    if detail is not None:
        entry["detail"] = detail
    return entry


def migrate_passwords(
    *,
    source_profile_dir: PathLike,
    target_profile_dir: PathLike,
    platform: str = sys.platform,
    resolve_source_key: Callable[[str], bytes] | None = None,
    target_key: bytes | None = None,
    target_prefix: str | None = None,
    domains=None,
) -> dict[str, Any]:
    """Copy ``Login Data`` and re-encrypt its passwords for the target.

    Args:
        resolve_source_key: ``resolve(prefix) -> key`` for the source profile
            (see :func:`create_source_key_resolver`).
        target_key: The dedicated profile's OSCrypt key.
        target_prefix: Prefix for re-encrypted values; ``v10`` on Windows and
            ``v11`` elsewhere by default.

    Raises:
        TypeError: When the source resolver or the target key is missing.
    """

    source_path = Path(source_profile_dir) / "Login Data"
    if not source_path.exists():
        return {
            "migrated": 0,
            "skipped": [
                {"type": "passwords", "item": "Login Data", "reason": "source-missing"}
            ],
            "warnings": [],
        }
    if not callable(resolve_source_key):
        msg = "migrate_passwords requires a resolve_source_key function"
        raise TypeError(msg)
    if not isinstance(target_key, (bytes, bytearray)):
        msg = "migrate_passwords requires a target encryption key"
        raise TypeError(msg)
    prefix_for_target = (
        default_target_prefix(platform) if target_prefix is None else target_prefix
    )

    target_dir = Path(target_profile_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / "Login Data"

    def rewrite(snapshot_path: Path) -> dict[str, Any]:
        shutil.copyfile(snapshot_path, target_path)
        skipped: list[dict[str, Any]] = []
        migrated = 0
        with contextlib.closing(sqlite3.connect(target_path)) as database:
            rows = database.execute(
                "SELECT rowid AS rowid, origin_url, password_value FROM logins"
            ).fetchall()
            for rowid, origin_url, password_value in rows:
                from .domains import matches_domains

                if not matches_domains(origin_url or "", domains):
                    database.execute("DELETE FROM logins WHERE rowid = ?", (rowid,))
                    continue
                encrypted_value = _to_bytes(password_value)
                if not encrypted_value:
                    continue
                prefix = encrypted_value[:3].decode("ascii", errors="replace")
                if prefix == "v20":
                    database.execute("DELETE FROM logins WHERE rowid = ?", (rowid,))
                    skipped.append(_skip(origin_url, "app-bound-v20"))
                    continue
                if prefix not in ("v10", "v11"):
                    database.execute("DELETE FROM logins WHERE rowid = ?", (rowid,))
                    skipped.append(_skip(origin_url, "unsupported-encryption"))
                    continue
                try:
                    plaintext = decrypt_chromium_cookie(
                        encrypted_value,
                        host=_host_from_origin(origin_url),
                        database_version=0,
                        platform=platform,
                        key=resolve_source_key(prefix),
                    )
                except Exception as error:
                    database.execute("DELETE FROM logins WHERE rowid = ?", (rowid,))
                    skipped.append(_skip(origin_url, "decrypt-failed", str(error)))
                    continue
                reencrypted = encrypt_chromium_value(
                    plaintext,
                    key=bytes(target_key),
                    platform=platform,
                    prefix=prefix_for_target,
                )
                database.execute(
                    "UPDATE logins SET password_value = ? WHERE rowid = ?",
                    (reencrypted, rowid),
                )
                migrated += 1
            database.commit()
            database.execute("VACUUM")
        return {"migrated": migrated, "skipped": skipped, "warnings": []}

    return with_database_snapshot(source_path, rewrite)
