"""The profile orchestrator copies only selected classes into a target."""

from __future__ import annotations

import json
from pathlib import Path

from browser_commander.browser.migration.profile import migrate_profile
from tests.helpers.migration_fixtures import write_firefox_profile, write_profile_json


# feature-parity: migration.profile@native-typed
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


async def test_imports_a_domain_from_whichever_installed_browser_holds_it(
    tmp_path: Path,
) -> None:
    home = tmp_path / "home"
    write_firefox_profile(home, [{"name": "a", "value": "1", "host": ".other.test"}])
    write_firefox_profile(
        home,
        [{"name": "session", "value": "s", "host": ".github.com"}],
        root=".librewolf",
        name="default",
    )

    report = await migrate_profile(
        from_={"browser": "default"},
        to=tmp_path / "target",
        include=["cookies"],
        domains=["github.com"],
        platform="linux",
        home_dir=home,
        environment={},
        run_command=lambda *_args: "firefox.desktop\n",
    )

    assert report["source"]["browser"] == "librewolf"
    assert report["source"]["profile"] == "default"
    assert report["migrated"]["cookies"] == 1
    assert [warning["reason"] for warning in report["warnings"]] == [
        "default-browser-fallback"
    ]


async def test_reads_a_single_profile_chromium_browser_opera_from_its_root(
    tmp_path: Path,
) -> None:
    root = tmp_path / ".config" / "opera"
    root.mkdir(parents=True)
    write_profile_json(
        root,
        "Bookmarks",
        {
            "roots": {
                "bookmark_bar": {
                    "type": "folder",
                    "children": [
                        {"type": "url", "name": "A", "url": "https://a.example/"}
                    ],
                }
            }
        },
    )

    report = await migrate_profile(
        from_={"browser": "opera"},
        to=tmp_path / "target",
        include=["bookmarks"],
        platform="linux",
        home_dir=tmp_path,
        environment={},
    )

    assert report["migrated"]["bookmarks"] == 1
    assert report["skipped"] == []
