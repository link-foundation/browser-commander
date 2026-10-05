# feature-parity: sources.cookie-listing@native-typed
"""Cookie-source listing parity (counts only, never values) for #114.

Mirrors ``js/tests/unit/browser/cookie-sources.test.js``.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import pytest

from browser_commander.browser.browser_cookies import (
    ImportSource,
    list_cookie_sources,
    resolve_import_source,
)
from tests.helpers.migration_fixtures import write_firefox_profile


def test_reports_cookie_counts_per_profile_without_reading_values(
    tmp_path: Path,
) -> None:
    profile_path = write_firefox_profile(
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
    write_firefox_profile(
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


# feature-parity: sources.default-domain-fallback@native-typed
_GITHUB_COOKIE = [{"name": "a", "value": "1", "host": ".github.com"}]
_OTHER_COOKIE = [{"name": "b", "value": "2", "host": ".other.test"}]


def _firefox_is_default(*_args: object) -> str:
    return "firefox.desktop\n"


def _no_default(*_args: object) -> str:
    raise RuntimeError("no xdg")


def _resolve(home: Path, **overrides: object) -> ImportSource:
    options: dict = {
        "domains": ["github.com"],
        "platform": "linux",
        "home_dir": home,
        "environment": {},
        "run_command": _firefox_is_default,
    }
    options.update(overrides)
    browser = options.pop("browser", "default")
    return resolve_import_source(browser, **options)


def test_import_source_keeps_the_system_default_when_it_holds_the_domains(
    tmp_path: Path,
) -> None:
    write_firefox_profile(tmp_path, _GITHUB_COOKIE)
    write_firefox_profile(tmp_path, _GITHUB_COOKIE, root=".librewolf", name="default")

    assert _resolve(tmp_path) == ImportSource(
        browser="firefox", profile="default-release", warning=None
    )


def test_import_source_falls_back_to_the_browser_that_holds_the_domains(
    tmp_path: Path,
) -> None:
    write_firefox_profile(tmp_path, _OTHER_COOKIE)
    write_firefox_profile(tmp_path, _GITHUB_COOKIE, root=".librewolf", name="default")

    source = _resolve(tmp_path)
    assert source.browser == "librewolf"
    assert source.profile == "default"
    assert source.warning is not None
    assert source.warning["reason"] == "default-browser-fallback"
    assert source.warning["item"] == "librewolf"
    assert (
        "default browser (firefox) holds no cookies for github.com; "
        "imported from librewolf" in source.warning["detail"]
    )


def test_import_source_falls_back_when_the_default_is_unknown(tmp_path: Path) -> None:
    home = tmp_path / "home"
    write_firefox_profile(home, _GITHUB_COOKIE, root=".librewolf", name="default")

    source = _resolve(home, run_command=_no_default)
    assert source.browser == "librewolf"
    assert source.warning is not None
    assert source.warning["reason"] == "default-browser-unknown"
    with pytest.raises(ValueError, match="no installed browser holds cookies"):
        _resolve(tmp_path / "empty", run_command=_no_default)


def test_import_source_resolves_the_default_plainly_without_domains(
    tmp_path: Path,
) -> None:
    assert _resolve(tmp_path, domains=None) == ImportSource(browser="firefox")
    assert _resolve(tmp_path, browser="Opera") == ImportSource(browser="opera")
