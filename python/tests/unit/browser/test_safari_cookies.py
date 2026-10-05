# feature-parity: sources.safari-cookies@native-typed
"""Shared Safari fixture decoding and installed/default/custom import regressions."""

import errno
import json
import struct
from pathlib import Path

import pytest

from browser_commander.browser.browser_cookies import (
    BrowserCookieReadOptions,
    list_cookie_sources,
    read_browser_cookies_with_dependencies,
    resolve_import_source,
)
from browser_commander.browser.browser_profiles import list_browser_profiles
from browser_commander.browser.migration.profile import migrate_profile_sync
from browser_commander.browser.safari_cookies import (
    parse_safari_cookies,
    read_safari_cookie_file,
)

FIXTURES = Path(__file__).resolve().parents[4] / "tests/fixtures/safari"
DATA = (FIXTURES / "Cookies.binarycookies").read_bytes()
EXPECTED = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))


def install(home, browser="safari", legacy=False):
    bundle = (
        "com.apple.Safari"
        if browser == "safari"
        else "com.apple.SafariTechnologyPreview"
    )
    root = (
        home / "Library"
        if legacy
        else home / "Library/Containers" / bundle / "Data/Library"
    )
    file = root / "Cookies/Cookies.binarycookies"
    file.parent.mkdir(parents=True)
    file.write_bytes(DATA)
    return root, file


def test_decodes_shared_fixture():
    assert parse_safari_cookies(DATA) == EXPECTED


def test_discovery_domains_are_exact_and_reader_filter_stays_substring(tmp_path):
    install(tmp_path)
    options = {"platform": "darwin", "home_dir": tmp_path, "environment": {}}
    assert list_cookie_sources(domains=["hub.com", "github.co"], **options) == []
    assert (
        read_browser_cookies_with_dependencies(
            BrowserCookieReadOptions(
                browser="safari", domain_filter="hub.com", cache=False
            ),
            **options,
        )
        == EXPECTED[:2]
    )


def test_rejects_truncation_and_forged_offsets():
    for end in range(len(DATA) - 8):
        with pytest.raises(ValueError, match="Invalid Safari binarycookies"):
            parse_safari_cookies(DATA[:end])
    for offset, value in [
        (4, 0xFFFFFFFF),
        (24, 0xFFFFFFFF),
        (28, 0xFFFFFFFF),
        (40, 0xFFFFFFFF),
        (56, 0),
    ]:
        broken = bytearray(DATA)
        struct.pack_into("<I", broken, offset, value)
        with pytest.raises(ValueError, match="Invalid Safari binarycookies"):
            parse_safari_cookies(bytes(broken))
    broken = bytearray(DATA)
    struct.pack_into("<d", broken, 80, float("nan"))
    with pytest.raises(ValueError, match="Invalid Safari binarycookies"):
        parse_safari_cookies(bytes(broken))


@pytest.mark.parametrize(
    ("browser", "legacy"),
    [("safari", False), ("safari-technology-preview", False), ("safari", True)],
)
def test_installed_profiles(tmp_path, browser, legacy):
    root, file = install(tmp_path, browser, legacy)
    options = {"platform": "darwin", "home_dir": tmp_path, "environment": {}}
    assert list_browser_profiles(browser=browser, **options)[0].path == root
    assert (
        read_browser_cookies_with_dependencies(
            BrowserCookieReadOptions(browser=browser, cache=False), **options
        )
        == EXPECTED
    )
    assert file.read_bytes() == DATA


def test_counts_and_default_migration(tmp_path):
    _, file = install(tmp_path)
    damaged = bytearray(DATA)
    damaged[40 + struct.unpack_from("<I", DATA, 68)[0]] = 0xFF
    file.write_bytes(damaged)
    options = {"platform": "darwin", "home_dir": tmp_path, "environment": {}}
    sources = list_cookie_sources(domains=["GITHUB.COM"], **options)
    assert len(sources) == 1
    assert sources[0].cookies == 4
    assert sources[0].by_domain == {"GITHUB.COM": 2}
    assert "fixture-token" not in repr(sources)
    file.write_bytes(DATA)

    def run_command(*_):
        return (
            '( { LSHandlerURLScheme = https; LSHandlerRoleAll = "com.apple.Safari"; } )'
        )

    assert (
        resolve_import_source(
            "default", domains=["github.com"], run_command=run_command, **options
        ).browser
        == "safari"
    )
    report = migrate_profile_sync(
        from_={"browser": "auto"},
        to=tmp_path / "target",
        domains=["github.com", "GITHUB.COM"],
        run_command=run_command,
        **options,
    )
    assert report["cookies"] == EXPECTED[:2]
    assert report["migrated"]["cookies"] == 2
    classes = json.loads(
        (FIXTURES.parent / "migration-data-classes.json").read_text(encoding="utf-8")
    )
    assert {entry["type"] for entry in report["skipped"]} == set(classes) - {"cookies"}
    assert (
        next(item for item in report["skipped"] if item["type"] == "passwords")[
            "reason"
        ]
        == "safari-password-export-required"
    )
    assert any(
        item["reason"] == "safari-samesite-unavailable" for item in report["warnings"]
    )


def test_custom_profile_and_protection_error(tmp_path, monkeypatch):
    root, file = install(tmp_path)
    assert (
        read_browser_cookies_with_dependencies(
            BrowserCookieReadOptions(
                browser="safari",
                profile_dir=root,
                domain_filter="github.com",
                cache=False,
            ),
            home_dir=tmp_path / "empty",
        )
        == EXPECTED[:2]
    )

    def denied(_self):
        raise PermissionError(errno.EPERM, "Operation not permitted")

    monkeypatch.setattr(Path, "read_bytes", denied)
    with pytest.raises(
        PermissionError,
        match=r"Full Disk Access.*TestTerminal.*x-apple.systempreferences:com.apple.preference.security\?Privacy_AllFiles",
    ):
        read_safari_cookie_file(file, environment={"TERM_PROGRAM": "TestTerminal"})


def test_unreadable_default_reports_source_error(tmp_path):
    _, file = install(tmp_path)
    file.write_bytes(b"corrupt")
    options = {"platform": "darwin", "home_dir": tmp_path, "environment": {}}
    assert (
        "Invalid Safari binarycookies"
        in list_cookie_sources(domains=["github.com"], **options)[0].error
    )

    def run_command(*_):
        return (
            '( { LSHandlerURLScheme = https; LSHandlerRoleAll = "com.apple.Safari"; } )'
        )

    with pytest.raises(
        RuntimeError,
        match=r"Could not inspect the default browser.*Invalid Safari binarycookies",
    ):
        resolve_import_source(
            "default", domains=["github.com"], run_command=run_command, **options
        )
