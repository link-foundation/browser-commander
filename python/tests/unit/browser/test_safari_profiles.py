import contextlib
import shutil
import sqlite3
from pathlib import Path

from browser_commander.browser.browser_cookies import list_cookie_sources
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


def test_catalogue_error_preserves_readable_profiles(tmp_path):
    fixtures = Path(__file__).resolve().parents[4] / "tests/fixtures"
    root = tmp_path / "Library/Containers/com.apple.Safari/Data/Library"
    (root / "Safari").mkdir(parents=True)
    (root / "Cookies").mkdir()
    shutil.copyfile(
        fixtures / "safari/Cookies.binarycookies",
        root / "Cookies/Cookies.binarycookies",
    )
    tabs = root / "Safari/SafariTabs.db"
    sqlite3.connect(tabs).close()
    chromium = tmp_path / "Library/Application Support/Google/Chrome/Default"
    chromium.mkdir(parents=True)
    with contextlib.closing(sqlite3.connect(chromium / "Cookies")) as db:
        db.executescript(
            "CREATE TABLE cookies(host_key TEXT); INSERT INTO cookies VALUES ('.github.com')"
        )
    before = tabs.read_bytes()
    options = {"platform": "darwin", "home_dir": tmp_path, "environment": {}}
    profiles = list_browser_profiles(**options)
    assert len([p for p in profiles if p.browser == "safari"]) == 2
    sources = list_cookie_sources(domains=["github.com"], **options)
    assert next(s for s in sources if s.browser == "chrome").cookies == 1
    assert (
        next(s for s in sources if s.browser == "safari" and not s.error).cookies == 4
    )
    assert (
        "no such table"
        in next(s for s in sources if s.browser == "safari" and s.error).error
    )
    assert tabs.read_bytes() == before
