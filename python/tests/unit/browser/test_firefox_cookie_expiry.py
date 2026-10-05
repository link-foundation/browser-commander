"""Firefox schema 16+ stores cookie expiry in milliseconds, not seconds."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from browser_commander import BrowserCookieReadOptions
from browser_commander.browser.browser_cookies import (
    read_browser_cookies_with_dependencies,
)
from browser_commander.browser.migration.profile import migrate_profile_sync

FIXTURE = (
    Path(__file__).resolve().parents[4] / "tests/fixtures/firefox-cookie-expiry.sql"
)


@pytest.mark.parametrize("version", [0, 15, 16, 17])
@pytest.mark.parametrize("migration", [False, True])
def test_firefox_cookie_expiry_units(tmp_path, version, migration):
    root = tmp_path / ".mozilla/firefox"
    source = root / "expiry.default-release"
    source.mkdir(parents=True)
    (root / "profiles.ini").write_text(
        "[Profile0]\nName=default-release\nIsRelative=1\n"
        "Path=expiry.default-release\nDefault=1\n",
        encoding="utf-8",
    )
    file = source / "cookies.sqlite"
    with closing(sqlite3.connect(file)) as database, database:
        database.executescript(FIXTURE.read_text(encoding="utf-8"))
        database.execute(f"PRAGMA user_version = {version}")
        if version >= 16:
            database.execute(
                "UPDATE moz_cookies SET expiry = expiry * 1000 + 999 WHERE expiry > 0"
            )
    before = file.read_bytes()
    if migration:
        report = migrate_profile_sync(
            from_={"browser": "firefox", "user_data_dir": source},
            to=tmp_path / "target",
            include=["cookies"],
            domains=["expiry.example"],
            platform="linux",
            home_dir=tmp_path,
            environment={},
        )
        cookies = report["cookies"]
        assert report["migrated"]["cookies"] == 3
    else:
        cookies = read_browser_cookies_with_dependencies(
            BrowserCookieReadOptions(
                browser="firefox", domain_filter="expiry.example", cache=False
            ),
            platform="linux",
            home_dir=tmp_path,
            environment={},
        )
    assert {cookie["name"]: cookie["expires"] for cookie in cookies} == {
        "persistent": 2_000_000_001,
        "session-negative": -1,
        "session-zero": -1,
    }
    assert file.read_bytes() == before
