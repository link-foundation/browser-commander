"""Translate individual Firefox visits through a consistent read-only snapshot."""

from __future__ import annotations

import sqlite3
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from browser_commander.browser.migration.chromium_writers import write_chromium_history
from browser_commander.browser.migration.domains import matches_domains
from browser_commander.browser.migration.fs_utils import (
    PathLike,
    profile_file_if_present,
)
from browser_commander.browser.migration.sqlite_snapshot import read_database_snapshot


def migrate_firefox_history(
    *,
    profile_dir: PathLike,
    target_profile_dir: PathLike,
    domains: Sequence[str] | None = None,
) -> dict[str, Any]:
    def entry(
        reason: str, detail: str | None = None, item: str = "places.sqlite"
    ) -> dict[str, Any]:
        result: dict[str, Any] = {"type": "history", "item": item, "reason": reason}
        if detail is not None:
            result["detail"] = detail
        return result

    filename = profile_file_if_present(profile_dir, "places.sqlite")
    if filename is None:
        return {"migrated": 0, "skipped": [entry("source-missing")], "warnings": []}

    def read(db: sqlite3.Connection) -> list[sqlite3.Row] | None:
        for table, required in (
            ("moz_places", ("id", "url", "title")),
            ("moz_historyvisits", ("id", "place_id", "visit_date")),
        ):
            columns = {row[1] for row in db.execute(f"PRAGMA table_info({table})")}
            if not set(required) <= columns:
                return None
        return db.execute(
            "SELECT p.url,p.title,v.id,v.visit_date AS time FROM moz_historyvisits v JOIN moz_places p ON v.place_id=p.id ORDER BY v.visit_date,v.id"
        ).fetchall()

    rows = read_database_snapshot(filename, read)
    if rows is None:
        return {
            "migrated": 0,
            "skipped": [
                entry(
                    "source-format-unsupported",
                    "Firefox history requires moz_places and moz_historyvisits with URL, title and integer visit dates; no target was written.",
                )
            ],
            "warnings": [],
        }
    skipped = []
    visits = []
    for row in rows:
        if not isinstance(row["url"], str) or not row["url"]:
            skipped.append(
                entry(
                    "invalid-history-url",
                    "The visit URL is not a nonempty string.",
                    f"places.sqlite visit {row['id']}",
                )
            )
            continue
        if not matches_domains(row["url"], domains):
            continue
        time = row["time"]
        if (
            not isinstance(time, int)
            or not -11644473600000000 <= time <= 9211727563254775807
        ):
            skipped.append(
                entry(
                    "invalid-history-timestamp",
                    "The visit date is not an integer representable in the target history format.",
                    f"places.sqlite visit {row['id']}",
                )
            )
            continue
        visits.append({"url": row["url"], "title": row["title"] or "", "time": time})
    migrated = write_chromium_history(Path(target_profile_dir), visits) if visits else 0
    return {
        "migrated": migrated,
        "skipped": skipped,
        "warnings": [
            entry(
                "firefox-history-metadata-not-translated",
                "URL/title and visit dates were translated; Firefox transition types, referring visits and sync metadata were not copied.",
            )
        ]
        if migrated
        else [],
    }
