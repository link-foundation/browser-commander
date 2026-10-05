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

from .domains import matches_domains

__all__ = ["migrate_history"]


def _snapshot_into(source_path: Path, target_path: Path, domains=None) -> int | None:
    """Copy a snapshot of ``source_path`` to ``target_path``; count its URLs."""

    def copy(snapshot_path: Path) -> int | None:
        shutil.copyfile(snapshot_path, target_path)
        if domains:
            import contextlib

            with contextlib.closing(sqlite3.connect(target_path)) as db:
                tables = {
                    row[0]
                    for row in db.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    )
                }
                if "urls" in tables:
                    for id_, url in db.execute("SELECT id,url FROM urls").fetchall():
                        if not matches_domains(url, domains):
                            db.execute("DELETE FROM urls WHERE id=?", (id_,))
                    for table, column in [
                        ("visits", "url"),
                        ("segments", "url_id"),
                        ("keyword_search_terms", "url_id"),
                    ]:
                        if table in tables:
                            db.execute(
                                f"DELETE FROM {table} WHERE {column} NOT IN (SELECT id FROM urls)"
                            )
                    if "visits" in tables:
                        for table, column in [
                            ("visit_source", "id"),
                            ("content_annotations", "visit_id"),
                            ("context_annotations", "visit_id"),
                            ("clusters_and_visits", "visit_id"),
                        ]:
                            if table in tables:
                                db.execute(
                                    f"DELETE FROM {table} WHERE {column} NOT IN (SELECT id FROM visits)"
                                )
                    if "segments" in tables and "segment_usage" in tables:
                        db.execute(
                            "DELETE FROM segment_usage WHERE segment_id NOT IN (SELECT id FROM segments)"
                        )
                _filter_downloads(db, tables, domains)
                if "top_sites" in tables:
                    for (url,) in db.execute("SELECT url FROM top_sites").fetchall():
                        if not matches_domains(url, domains):
                            db.execute("DELETE FROM top_sites WHERE url=?", (url,))
                db.commit()
                db.execute("VACUUM")
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


def _filter_downloads(db, tables, domains):
    if "downloads" not in tables:
        return
    cursor = db.execute("SELECT * FROM downloads")
    columns = [column[0] for column in cursor.description]
    for values in cursor.fetchall():
        row = dict(zip(columns, values))
        urls = [
            row.get(column)
            for column in ["url", "site_url", "tab_url", "referrer", "tab_referrer_url"]
            if row.get(column)
        ]
        if "downloads_url_chains" in tables:
            urls.extend(
                chain[0]
                for chain in db.execute(
                    "SELECT url FROM downloads_url_chains WHERE id=?", (row["id"],)
                )
            )
        if not urls or any(not matches_domains(url, domains) for url in urls):
            db.execute("DELETE FROM downloads WHERE id=?", (row["id"],))
    for table, column in [
        ("downloads_url_chains", "id"),
        ("downloads_slices", "download_id"),
    ]:
        if table in tables:
            db.execute(
                f"DELETE FROM {table} WHERE {column} NOT IN (SELECT id FROM downloads)"
            )


def migrate_history(
    *, source_profile_dir: PathLike, target_profile_dir: PathLike, domains=None
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
        count = _snapshot_into(history_source, target / "History", domains)
        url_count = count or 0
        migrated_databases += 1
    else:
        skipped.append(
            {"type": "history", "item": "History", "reason": "source-missing"}
        )

    top_sites_source = source / "Top Sites"
    if top_sites_source.exists():
        _snapshot_into(top_sites_source, target / "Top Sites", domains)
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
