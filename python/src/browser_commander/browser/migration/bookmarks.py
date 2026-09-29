"""Migrate Chromium bookmarks by copying the ``Bookmarks`` JSON verbatim.

The file is not encrypted and carries no per-profile MAC, so a byte-for-byte
copy is the most faithful migration; Chrome recomputes the checksum on load.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from browser_commander.browser.migration.fs_utils import PathLike

__all__ = [
    "count_bookmarks",
    "migrate_bookmarks",
]


def count_bookmarks(bookmarks: Any) -> int:
    """Count URL nodes under every root of a Chrome ``Bookmarks`` document."""

    count = 0

    def visit(node: Any) -> None:
        nonlocal count
        if not isinstance(node, Mapping):
            return
        if node.get("type") == "url":
            count += 1
        for child in node.get("children") or []:
            visit(child)

    roots = bookmarks.get("roots") if isinstance(bookmarks, Mapping) else None
    for root in (roots or {}).values():
        visit(root)
    return count


def migrate_bookmarks(
    *, source_profile_dir: PathLike, target_profile_dir: PathLike
) -> dict[str, Any]:
    """Copy ``Bookmarks`` into the target profile.

    Returns:
        ``{"migrated": <url count>, "skipped": [...], "warnings": [...]}``.
    """

    source = Path(source_profile_dir) / "Bookmarks"
    if not source.exists():
        return {
            "migrated": 0,
            "skipped": [
                {
                    "type": "bookmarks",
                    "item": "Bookmarks",
                    "reason": "source-has-no-bookmarks",
                }
            ],
            "warnings": [],
        }
    count = 0
    try:
        count = count_bookmarks(json.loads(source.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        # An unreadable document is still copied; only the count is lost.
        count = 0
    target = Path(target_profile_dir)
    target.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target / "Bookmarks")
    return {"migrated": count, "skipped": [], "warnings": []}
