"""Target-native Chromium formats for translated Safari data."""

from __future__ import annotations

import contextlib
import json
import sqlite3
from pathlib import Path
from typing import Any


def write_chromium_bookmarks(
    target_profile_dir: Path, entries: list[dict[str, Any]]
) -> int:
    id_ = 3
    count = 0

    def convert(node: dict[str, Any]) -> dict[str, Any]:
        nonlocal id_, count
        id_ += 1
        result = {
            "id": str(id_),
            "date_added": "13300000000000000",
            "name": node["name"],
            "type": node["type"],
        }
        if node["type"] == "url":
            count += 1
            result["url"] = node["url"]
        else:
            result["date_modified"] = result["date_added"]
            result["children"] = [convert(child) for child in node.get("children", [])]
        return result

    roots = {
        name: {
            "id": str(index + 1),
            "name": name,
            "type": "folder",
            "date_added": "13300000000000000",
            "date_modified": "13300000000000000",
            "children": [convert(node) for node in entries] if name == "other" else [],
        }
        for index, name in enumerate(("bookmark_bar", "other", "synced"))
    }
    target_profile_dir.mkdir(parents=True, exist_ok=True)
    (target_profile_dir / "Bookmarks").write_text(
        json.dumps({"version": 1, "roots": roots}), encoding="utf-8"
    )
    return count


def write_chromium_history(
    target_profile_dir: Path, entries: list[dict[str, Any]]
) -> int:
    target_profile_dir.mkdir(parents=True, exist_ok=True)
    with contextlib.closing(sqlite3.connect(target_profile_dir / "History")) as db:
        db.executescript(Path(__file__).with_name("chromium-history.sql").read_text())
        urls = {}
        for entry in entries:
            if entry["url"] not in urls:
                urls[entry["url"]] = db.execute(
                    "INSERT INTO urls (url,title,visit_count,last_visit_time) VALUES (?,?,0,0)",
                    (entry["url"], entry["title"]),
                ).lastrowid
            id_ = urls[entry["url"]]
            time = entry["time"] + 11644473600000000
            db.execute(
                "UPDATE urls SET title=?,visit_count=visit_count+1,last_visit_time=max(last_visit_time,?) WHERE id=?",
                (entry["title"], time, id_),
            )
            db.execute("INSERT INTO visits (url,visit_time) VALUES (?,?)", (id_, time))
        db.commit()
    return len(entries)
