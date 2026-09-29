"""The profile orchestrator copies only selected classes into a target."""

from __future__ import annotations

import json
from pathlib import Path

from browser_commander.browser.migration.profile import migrate_profile


# feature-parity: migration.profile
async def test_copies_bookmarks_without_touching_the_source(tmp_path: Path) -> None:
    source = tmp_path / "source"
    profile = source / "Default"
    profile.mkdir(parents=True)
    bookmarks = {
        "roots": {
            "bookmark_bar": {
                "children": [
                    {"type": "url", "name": "Example", "url": "https://example.com/"}
                ]
            }
        }
    }
    original = json.dumps(bookmarks)
    (profile / "Bookmarks").write_text(original, encoding="utf-8")
    target = tmp_path / "target" / "Default"

    report = await migrate_profile(
        from_={"browser": "chrome", "user_data_dir": source},
        to=target,
        include=["bookmarks"],
    )

    assert report["migrated"]["bookmarks"] == 1
    assert report["migrated"]["cookies"] == 0
    assert report["cookies"] == []
    assert (target / "Bookmarks").read_text(encoding="utf-8") == original
    assert (profile / "Bookmarks").read_text(encoding="utf-8") == original
