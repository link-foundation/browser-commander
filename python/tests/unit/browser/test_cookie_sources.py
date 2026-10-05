# feature-parity: sources.cookie-listing@native-typed
"""Cookie-source listing parity (counts only, never values) for #114.

Mirrors ``js/tests/unit/browser/cookie-sources.test.js``.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

from browser_commander.browser.browser_cookies import list_cookie_sources
from tests.helpers.migration_fixtures import write_firefox_cookies


def _make_firefox_profile(home: Path, cookies: list[dict]) -> Path:
    root = home / ".mozilla" / "firefox"
    profile_name = "xyz.default-release"
    profile_path = root / profile_name
    profile_path.mkdir(parents=True)
    (root / "profiles.ini").write_text(
        f"[Profile0]\nName=default-release\nIsRelative=1\n"
        f"Path={profile_name}\nDefault=1\n",
        encoding="utf-8",
    )
    write_firefox_cookies(profile_path, cookies)
    return profile_path


def test_reports_cookie_counts_per_profile_without_reading_values(
    tmp_path: Path,
) -> None:
    profile_path = _make_firefox_profile(
        tmp_path,
        [
            {"name": "a", "value": "secret-1", "host": ".example.com"},
            {"name": "b", "value": "secret-2", "host": ".example.com"},
            {"name": "c", "value": "secret-3", "host": ".other.test"},
        ],
    )

    sources = list_cookie_sources(platform="linux", home_dir=tmp_path)

    assert len(sources) == 1
    source = sources[0]
    assert source.browser == "firefox"
    assert source.path == profile_path
    assert source.cookies == 3
    assert source.by_domain is None
    # Never expose a value anywhere in the payload.
    serialized = json.dumps([asdict(item) for item in sources], default=str)
    assert "secret-" not in serialized


def test_counts_per_domain_and_omits_profiles_that_hold_none(tmp_path: Path) -> None:
    _make_firefox_profile(
        tmp_path,
        [
            {"name": "a", "value": "1", "host": ".example.com"},
            {"name": "b", "value": "2", "host": ".example.com"},
        ],
    )

    matched = list_cookie_sources(
        domains=["example.com"], platform="linux", home_dir=tmp_path
    )
    assert len(matched) == 1
    assert matched[0].by_domain == {"example.com": 2}

    none = list_cookie_sources(
        domains=["absent.test"], platform="linux", home_dir=tmp_path
    )
    assert none == []
