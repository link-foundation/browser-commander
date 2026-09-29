"""Migrate Chromium history by snapshotting ``History`` and ``Top Sites``.

Both are SQLite databases the source browser keeps open, so each is copied
through a consistent read-only backup snapshot rather than a raw file copy.
"""

from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path
from typing import Any

from browser_commander.browser.migration.fs_utils import PathLike
from browser_commander.browser.migration.sqlite_snapshot import (
    with_database_snapshot,
)

__all__ = ["migrate_history"]


def _snapshot_into(source_path: Path, target_path: Path) -> int | None:
    """Copy a snapshot of ``source_path`` to ``target_path``; count its URLs."""

    def copy(snapshot_path: Path) -> int | None:
        shutil.copyfile(snapshot_path, target_path)
        try:
            connection = sqlite3.connect(
                f"{target_path.resolve().as_uri()}?mode=ro", uri=True
            )
            try:
                row = connection.execute("SELECT COUNT(*) FROM urls").fetchone()
            finally:
                connection.close()
        except sqlite3.Error:
            return None
        return int(row[0] if row and row[0] is not None else 0)

    return with_database_snapshot(source_path, copy)


def migrate_history(
    *, source_profile_dir: PathLike, target_profile_dir: PathLike
) -> dict[str, Any]:
    """Copy ``History`` (and ``Top Sites`` when present) into the target.

    Returns:
        ``{"migrated": 1 if anything was copied else 0, "skipped": [...],
        "warnings": [...]}``.
    """

    skipped: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    source = Path(source_profile_dir)
    target = Path(target_profile_dir)
    target.mkdir(parents=True, exist_ok=True)

    url_count = 0
    migrated_databases = 0
    history_source = source / "History"
    if history_source.exists():
        count = _snapshot_into(history_source, target / "History")
        url_count = count or 0
        migrated_databases += 1
    else:
        skipped.append(
            {"type": "history", "item": "History", "reason": "source-missing"}
        )

    top_sites_source = source / "Top Sites"
    if top_sites_source.exists():
        _snapshot_into(top_sites_source, target / "Top Sites")
        migrated_databases += 1

    if url_count > 0:
        warnings.append(
            {
                "type": "history",
                "item": "History",
                "reason": "snapshot-copied",
                "detail": f"{url_count} history URLs copied via the SQLite backup API",
            }
        )
    return {
        "migrated": 1 if migrated_databases > 0 else 0,
        "skipped": skipped,
        "warnings": warnings,
    }
