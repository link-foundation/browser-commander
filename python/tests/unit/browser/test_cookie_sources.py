# feature-parity: sources.cookie-listing@native-typed
"""Cookie-source listing parity (counts only, never values) for #114.

Mirrors ``js/tests/unit/browser/cookie-sources.test.js``.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from pathlib import Path

import pytest

from browser_commander.browser.browser_cookies import (
    ImportSource,
    list_cookie_sources,
    resolve_import_source,
)
from browser_commander.browser.migration.profile import migrate_profile_sync
from tests.helpers.migration_fixtures import write_firefox_profile


@pytest.mark.parametrize("browser", ["firefox", "chrome"])
def test_source_domains_match_only_whole_hosts_and_subdomains(tmp_path, browser):
    hosts = [
        ".github.com",
        "api.GITHUB.COM.",
        "notgithub.com",
        ".github.com.attacker.test",
        ".gitXhub.com",
    ]
    if browser == "firefox":
        profile = write_firefox_profile(
            tmp_path,
            [
                {"host": host, "name": str(index), "value": "secret"}
                for index, host in enumerate(hosts)
            ],
        )
        file = profile / "cookies.sqlite"
    else:
        file = tmp_path / ".config/google-chrome/Default/Cookies"
        file.parent.mkdir(parents=True)
        with sqlite3.connect(file) as database:
            database.execute("CREATE TABLE cookies (host_key TEXT, value TEXT)")
            database.executemany(
                "INSERT INTO cookies VALUES (?, ?)",
                [(host, "secret") for host in hosts],
            )
    before = file.read_bytes()
    sources = list_cookie_sources(
        domains=["GITHUB.COM.", "git_hub.com", "%github.com"],
        platform="linux",
        home_dir=tmp_path,
        environment={},
    )
    assert len(sources) == 1
    assert sources[0].browser == browser
    assert sources[0].cookies == len(hosts)
    assert sources[0].by_domain == {
        "GITHUB.COM.": 2,
        "git_hub.com": 0,
        "%github.com": 0,
    }
    assert "secret" not in repr(sources)
    assert file.read_bytes() == before


def test_import_source_ignores_lookalike_domain_in_default_browser(tmp_path):
    write_firefox_profile(
        tmp_path,
        [
            {"name": "lookalike", "value": "secret", "host": ".notgithub.com"},
        ],
    )
    write_firefox_profile(tmp_path, _GITHUB_COOKIE, root=".librewolf", name="default")
    source = _resolve(tmp_path)
    assert source.browser == "librewolf"
    assert source.warning["reason"] == "default-browser-fallback"
    report = migrate_profile_sync(
        from_={"browser": "auto"},
        to=tmp_path / "target",
        include=["cookies"],
        domains=["github.com"],
        platform="linux",
        home_dir=tmp_path,
        environment={},
        run_command=_firefox_is_default,
    )
    assert report["source"]["browser"] == "librewolf"
    assert report["migrated"]["cookies"] == 1
    assert report["cookies"][0]["domain"] == ".github.com"


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
