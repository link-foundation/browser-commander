"""Stage password writes privately; merge compatible closed stores without loss."""

from __future__ import annotations

import contextlib
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

from browser_commander.utilities.subprocess import run_command_sync

from ..browser_cookie_crypto import decrypt_chromium_cookie
from .sqlite_snapshot import _backup
from .validation import validate_migration_paths

IDENTITY = (
    "origin_url",
    "username_element",
    "username_value",
    "password_element",
    "signon_realm",
)
TABLES = {
    "logins",
    "meta",
    "password_notes",
    "insecure_credentials",
    "stats",
    "sync_entities_metadata",
    "sync_model_metadata",
    "incoming_sharing_invitation_sync_entities_metadata",
    "incoming_sharing_invitation_sync_model_metadata",
}
LOGIN_COLUMNS = {
    "id",
    "origin_url",
    "action_url",
    "username_element",
    "username_value",
    "password_element",
    "password_value",
    "submit_element",
    "signon_realm",
    "date_created",
    "blacklisted_by_user",
    "scheme",
    "password_type",
    "times_used",
    "form_data",
    "display_name",
    "icon_url",
    "federation_url",
    "skip_zero_click",
    "generation_upload_status",
    "possible_username_pairs",
    "date_last_used",
    "moving_blocked_for",
    "date_password_modified",
    "date_synced",
    "preferred",
    "ssl_valid",
    "possible_usernames",
    "use_additional_auth",
    "sender_email",
    "sender_name",
    "date_received",
    "sharing_notification_displayed",
    "sender_profile_image_url",
    "keychain_identifier",
    "date_last_filled",
    "actor_login_approved",
}
GUIDANCE = "Close the target browser and retry. For unsupported stores use a fresh dedicated profile; refresh cookies through the running browser cookie API."


def refuse(reason):
    raise ValueError(f"Password refresh refused ({reason}). {GUIDANCE}")


def _active_sidecar(marker, suffix):
    if not marker.exists() and not marker.is_symlink():
        return False
    if suffix != "-journal" or marker.is_symlink():
        return True
    # SQLite PERSIST leaves a zeroed rollback header after a clean close.
    with marker.open("rb") as journal:
        return any(journal.read(8))


def assert_password_target_closed(target_profile_dir):
    target = Path(target_profile_dir).resolve()
    dirs = (target, target.parent)
    for directory in dirs:
        for name in ("SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"):
            marker = directory / name
            if marker.exists() or marker.is_symlink():
                refuse("target-active")
    for suffix in ("-wal", "-shm", "-journal"):
        marker = target / f"Login Data{suffix}"
        if _active_sidecar(marker, suffix):
            refuse("target-active")
    command = (
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine",
        ]
        if sys.platform == "win32"
        else ["ps", "-axww", "-o", "args="]
    )
    try:
        output = run_command_sync(command[0], command[1:]).stdout
    except (OSError, subprocess.SubprocessError):
        refuse("target-state-unavailable")
    for line in output.splitlines():
        match = re.search(
            r"""(?:^|\s)(?:"--user-data-dir(?:=|\s+)([^"]+)"|--user-data-dir(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(.+)))""",
            line,
        )
        if not match:
            continue
        quoted = next((value for value in match.groups()[:3] if value), None)
        # ps drops quoting; resolve every argument boundary to handle spaces and
        # aliases such as macOS /var without comparing literal path spellings.
        candidates = (
            [quoted]
            if quoted
            else [match[4][: end.start()] for end in re.finditer(r"\s|$", match[4])]
        )
        for value in candidates:
            if value and Path(value).resolve() in dirs:
                refuse("target-active")


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


def _columns(db, table):
    return db.execute(f"PRAGMA table_info({_quote(table)})").fetchall()


def _validate_schema(source, target):
    for db in (source, target):
        for kind, name in db.execute(
            "SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'"
        ):
            if kind in ("trigger", "view") or (kind == "table" and name not in TABLES):
                refuse("unsupported-password-schema")
        names = [row[1] for row in _columns(db, "logins")]
        if any(name not in names for name in (*IDENTITY, "password_value")) or any(
            name not in LOGIN_COLUMNS for name in names
        ):
            refuse("unsupported-password-schema")
        if (
            "keychain_identifier" in names
            and db.execute(
                "SELECT 1 FROM logins WHERE length(keychain_identifier)>0 LIMIT 1"
            ).fetchone()
        ):
            refuse("unsupported-password-schema")
    for table in ("logins", "password_notes", "insecure_credentials"):
        if _columns(source, table) != _columns(target, table):
            refuse("unsupported-password-schema")
    if bool(_columns(source, "meta")) != bool(_columns(target, "meta")):
        refuse("unsupported-password-schema")
    if _columns(source, "meta"):
        sql = "SELECT key,value FROM meta WHERE key IN ('version','last_compatible_version') ORDER BY key"
        if [(key, str(value)) for key, value in source.execute(sql)] != [
            (key, str(value)) for key, value in target.execute(sql)
        ]:
            refuse("unsupported-password-schema")
    for table, allowed in (
        (
            "password_notes",
            {"id", "parent_id", "key", "value", "date_created", "confidential"},
        ),
        (
            "insecure_credentials",
            {
                "parent_id",
                "insecurity_type",
                "create_time",
                "is_muted",
                "trigger_notification_from_backend",
            },
        ),
    ):
        names = [row[1] for row in _columns(target, table)]
        if names and (
            "parent_id" not in names
            or not any(row[1] == "id" for row in _columns(target, "logins"))
            or any(name not in allowed for name in names)
        ):
            refuse("unsupported-password-schema")
    for table in ("logins", "password_notes"):
        pk = [row for row in _columns(target, table) if row[5]]
        if pk and (len(pk) != 1 or pk[0][1] != "id" or pk[0][2].upper() != "INTEGER"):
            refuse("unsupported-password-schema")


def _validate_key(db, key, platform):
    for table, column in (("logins", "password_value"), ("password_notes", "value")):
        if not _columns(db, table):
            continue
        for (value,) in db.execute(f"SELECT {_quote(column)} FROM {_quote(table)}"):
            if not value:
                continue
            if value[:3] not in (b"v10", b"v11"):
                refuse("target-encryption-unsupported")
            try:
                decrypt_chromium_cookie(
                    value, host="", database_version=0, platform=platform, key=key
                )
            except Exception:
                refuse("target-key-mismatch")


def _rows(db, sql, params=()):
    cursor = db.execute(sql, params)
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def _insert(db, table, row, omit=()):
    names = [name for name in row if name not in omit]
    return db.execute(
        f"INSERT INTO {_quote(table)} ({','.join(map(_quote, names))}) VALUES ({','.join('?' for _ in names)})",
        [row[name] for name in names],
    ).lastrowid


def _merge(source, target, report, key, platform):
    _validate_schema(source, target)
    _validate_key(target, key, platform)
    migrated, inserted = 0, 0
    has_id = any(row[1] == "id" for row in _columns(source, "logins"))
    find = "SELECT 1 FROM logins WHERE " + " AND ".join(
        f"{_quote(name)} IS ?" for name in IDENTITY
    )
    for row in _rows(source, "SELECT * FROM logins ORDER BY rowid"):
        if target.execute(find, [row[name] for name in IDENTITY]).fetchone():
            report["skipped"].append(
                {"type": "passwords", "item": "Login Data", "reason": "target-existing"}
            )
            continue
        new_id = _insert(target, "logins", row, ("id",))
        inserted += 1
        if has_id:
            for table in ("password_notes", "insecure_credentials"):
                if not _columns(source, table):
                    continue
                for child in _rows(
                    source, f"SELECT * FROM {table} WHERE parent_id=?", (row["id"],)
                ):
                    _insert(target, table, {**child, "parent_id": new_id}, ("id",))
        migrated += bool(row["password_value"])
    return {**report, "migrated": migrated}, inserted > 0


def preflight_password_store(source_profile_dir, target_profile_dir):
    assert_password_target_closed(target_profile_dir)
    for directory in (source_profile_dir, target_profile_dir):
        if directory is None:
            continue
        for suffix in ("-wal", "-shm", "-journal"):
            marker = Path(directory) / f"Login Data For Account{suffix}"
            if _active_sidecar(marker, suffix):
                refuse("account-store-unsupported")
        account = Path(directory) / "Login Data For Account"
        if not account.exists() and not account.is_symlink():
            continue
        try:
            with contextlib.closing(
                sqlite3.connect(account.resolve().as_uri() + "?mode=ro", uri=True)
            ) as db:
                names = {
                    row[0]
                    for row in db.execute(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
                    )
                }
                if "logins" not in names or not names.issubset(TABLES):
                    refuse("account-store-unsupported")
                login_names = {row[1] for row in _columns(db, "logins")}
                if not {*IDENTITY, "password_value"}.issubset(
                    login_names
                ) or not login_names.issubset(LOGIN_COLUMNS):
                    refuse("account-store-unsupported")
                for table in ("logins", "password_notes", "insecure_credentials"):
                    if (
                        table in names
                        and db.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone()
                    ):
                        refuse("account-store-unsupported")
        except sqlite3.Error:
            refuse("account-store-unsupported")


def with_password_store(
    *, target_profile_dir, target_key, platform, prepare, source_profile_dir=None
):
    target = Path(target_profile_dir)
    if source_profile_dir is not None:
        validate_migration_paths(source_profile_dir, target)
    preflight_password_store(source_profile_dir, target)
    target_path = target / "Login Data"
    if target_path.is_symlink():
        refuse("unsupported-password-schema")
    original = target_path.read_bytes() if target_path.exists() else None
    target.mkdir(parents=True, exist_ok=True)
    lock_path = target / ".password-refresh.lock"
    try:
        lock = lock_path.open("xb")
    except FileExistsError:
        refuse("target-busy")
    try:
        with tempfile.TemporaryDirectory(
            prefix=".password-refresh-", dir=target
        ) as directory:
            prepared = Path(directory) / "source"
            report = prepare(prepared)
            publish, changed = prepared, True
            if original is not None:
                publish = Path(directory) / "target"
                _backup(target_path, publish)
                with (
                    contextlib.closing(sqlite3.connect(prepared)) as source,
                    contextlib.closing(sqlite3.connect(publish)) as destination,
                ):
                    try:
                        report, changed = _merge(
                            source, destination, report, target_key, platform
                        )
                        destination.commit()
                    except sqlite3.Error:
                        refuse("unsupported-password-schema")
            preflight_password_store(source_profile_dir, target)
            current = target_path.read_bytes() if target_path.exists() else None
            if current != original:
                refuse("target-changed")
            if changed:
                publish.chmod(0o600)
                publish.replace(target_path)
            return report
    finally:
        lock.close()
        lock_path.unlink()
