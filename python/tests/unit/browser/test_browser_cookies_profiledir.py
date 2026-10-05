"""``profile_dir`` override parity for #114.

Mirrors ``js/tests/unit/browser/browser-cookies-profiledir.test.js``.
"""

from __future__ import annotations

from pathlib import Path

from browser_commander.browser.browser_cookies import (
    BrowserCookieReadOptions,
    read_browser_cookies_with_dependencies,
)
from tests.helpers.migration_fixtures import write_firefox_cookies


def test_reads_cookies_from_the_given_directory_not_the_default_root(
    tmp_path: Path,
) -> None:
    # A custom profile dir that is NOT under the default profile root.
    custom_profile = tmp_path / "custom" / "profile"
    custom_profile.mkdir(parents=True)
    write_firefox_cookies(
        custom_profile, [{"name": "sid", "value": "abc", "host": ".example.com"}]
    )

    # home_dir points somewhere with no browser data, so a reader that ignored
    # profile_dir and re-resolved the default profile would find nothing.
    empty_home = tmp_path / "empty-home"
    empty_home.mkdir(parents=True)

    cookies = read_browser_cookies_with_dependencies(
        BrowserCookieReadOptions(browser="firefox", profile_dir=custom_profile),
        platform="linux",
        home_dir=empty_home,
    )

    assert len(cookies) == 1
    assert cookies[0]["name"] == "sid"
    assert cookies[0]["domain"] == ".example.com"
