"""Filter Login Data associations and re-key notes after pruning logins."""

from __future__ import annotations

import sqlite3
from collections.abc import Callable
from typing import Any

from .domains import matches_domains


def migrate_password_metadata(
    database: sqlite3.Connection,
    domains,
    rewrite_value: Callable[[Any, Any], tuple[bytes | None, dict[str, Any] | None]],
    skipped: list[dict[str, Any]],
    warnings: list[dict[str, Any]],
) -> None:
    tables = [
        row[0]
        for row in database.execute("SELECT name FROM sqlite_master WHERE type='table'")
    ]
    for table in ("password_notes", "insecure_credentials"):
        if table in tables:
            database.execute(
                f"DELETE FROM {table} WHERE NOT EXISTS (SELECT 1 FROM logins WHERE logins.id={table}.parent_id)"
            )
    if "password_notes" in tables:
        rows = database.execute(
            "SELECT password_notes.rowid,logins.origin_url,password_notes.value FROM password_notes JOIN logins ON logins.id=password_notes.parent_id"
        ).fetchall()
        for rowid, origin, value in rows:
            encrypted, error = rewrite_value(value, origin)
            if error is not None:
                database.execute("DELETE FROM password_notes WHERE rowid=?", (rowid,))
                skipped.append({**error, "item": f"password_notes/{rowid}"})
            else:
                database.execute(
                    "UPDATE password_notes SET value=? WHERE rowid=?",
                    (encrypted, rowid),
                )
    sync_tables = (
        "sync_entities_metadata",
        "sync_model_metadata",
        "incoming_sharing_invitation_sync_entities_metadata",
        "incoming_sharing_invitation_sync_model_metadata",
    )
    for table in sync_tables:
        if table in tables:
            _reset_metadata(database, table, "sync-metadata-reset", warnings)
    if not domains:
        return
    if "stats" in tables:
        for rowid, origin in database.execute(
            "SELECT rowid,origin_domain FROM stats"
        ).fetchall():
            if not matches_domains(origin or "", domains):
                database.execute("DELETE FROM stats WHERE rowid=?", (rowid,))
    known = {
        "logins",
        "meta",
        "password_notes",
        "insecure_credentials",
        "stats",
        *sync_tables,
    }
    for table in tables:
        if table not in known and not table.startswith("sqlite_"):
            _reset_metadata(database, table, "unsupported-password-metadata", warnings)


def _reset_metadata(database, table, reason, warnings):
    quoted = '"' + table.replace('"', '""') + '"'
    count = database.execute(f"DELETE FROM {quoted}").rowcount
    if count:
        warnings.append(
            {
                "type": "passwords",
                "item": table,
                "reason": reason,
                "detail": f"{count} copied metadata rows removed",
            }
        )
