import contextlib
import shutil
import sqlite3
from pathlib import Path

from browser_commander.browser.browser_profiles import list_browser_profiles
from browser_commander.browser.safari_cookies import find_safari_cookie_file


def test_named_profiles_prefer_modern_cookie_stores(tmp_path):
    fixtures = Path(__file__).resolve().parents[4] / "tests/fixtures"
    uuid = "11111111-2222-3333-4444-555555555555"
    root = tmp_path / "Library/Containers/com.apple.Safari/Data/Library"
    named = root / "Safari/Profiles" / uuid
    named.mkdir(parents=True)
    with contextlib.closing(sqlite3.connect(root / "Safari/SafariTabs.db")) as db:
        db.executescript((fixtures / "safari-data/SafariTabs.sql").read_text())
    locations = [
        "Cookies",
        "WebKit/WebsiteData/Default/Cookies",
        f"WebKit/WebsiteDataStore/{uuid}/Cookies",
    ]
    for location in locations:
        (root / location).mkdir(parents=True)
        shutil.copyfile(
            fixtures / "safari/Cookies.binarycookies",
            root / location / "Cookies.binarycookies",
        )
    profiles = list_browser_profiles(
        "safari", platform="darwin", home_dir=tmp_path, environment={}
    )
    assert [profile.name for profile in profiles] == ["Default", uuid]
    assert profiles[1].display_name == "Work"
    assert profiles[1].path == named
    assert (
        find_safari_cookie_file(root) == root / locations[1] / "Cookies.binarycookies"
    )
    assert (
        find_safari_cookie_file(named) == root / locations[2] / "Cookies.binarycookies"
    )
