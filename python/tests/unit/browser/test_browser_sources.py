# feature-parity: sources.catalogue@native-typed
"""Catalogue loader parity with ``js/src/browser/browser-sources.js``."""

from __future__ import annotations

import pytest

from browser_commander.browser.browser_sources import (
    BROWSER_IDS,
    browser_family,
    default_browser_identifiers,
    find_browser_source,
    is_single_profile_browser,
    normalize_browser_id,
    resolve_browser_roots,
    safe_storage_identity,
)


def test_keeps_original_browsers_resolvable_by_id_and_alias() -> None:
    assert normalize_browser_id("chrome") == "chrome"
    assert normalize_browser_id("msedge") == "edge"
    assert normalize_browser_id("microsoft-edge") == "edge"
    assert normalize_browser_id("google-chrome") == "chrome"
    assert normalize_browser_id("CHROME") == "chrome"


def test_adds_the_new_source_browsers_from_114() -> None:
    for browser_id in [
        "opera",
        "opera-gx",
        "vivaldi",
        "arc",
        "yandex",
        "chrome-beta",
        "chrome-dev",
        "chrome-canary",
        "edge-beta",
        "edge-dev",
        "librewolf",
        "waterfox",
        "zen",
        "floorp",
        "firefox-developer",
        "firefox-nightly",
    ]:
        assert browser_id in BROWSER_IDS, f"missing {browser_id}"
        assert find_browser_source(browser_id), f"unresolvable {browser_id}"


def test_rejects_an_unknown_browser_with_the_catalogue_listed() -> None:
    with pytest.raises(
        ValueError, match=r"Unsupported browser: netscape\. Expected one of .*chrome"
    ):
        normalize_browser_id("netscape")


def test_classifies_browser_families() -> None:
    assert browser_family("chrome") == "chromium"
    assert browser_family("opera") == "chromium"
    assert browser_family("firefox") == "firefox"
    assert browser_family("librewolf") == "firefox"


def test_expands_per_platform_roots_with_the_home_directory() -> None:
    assert resolve_browser_roots("chrome", platform="linux", home_dir="/home/me") == [
        "/home/me/.config/google-chrome"
    ]
    assert resolve_browser_roots(
        "firefox", platform="darwin", home_dir="/Users/me"
    ) == ["/Users/me/Library/Application Support/Firefox"]


def test_honours_xdg_config_home_on_linux() -> None:
    assert resolve_browser_roots(
        "chromium",
        platform="linux",
        home_dir="/home/me",
        environment={"XDG_CONFIG_HOME": "/cfg"},
    ) == ["/cfg/chromium"]


def test_builds_windows_roots_with_backslashes() -> None:
    assert resolve_browser_roots(
        "opera",
        platform="win32",
        home_dir="C:\\Users\\me",
        environment={"APPDATA": "C:\\Users\\me\\AppData\\Roaming"},
    ) == ["C:\\Users\\me\\AppData\\Roaming\\Opera Software\\Opera Stable"]
    assert resolve_browser_roots(
        "chrome",
        platform="win32",
        home_dir="C:\\Users\\me",
        environment={"LOCALAPPDATA": "C:\\Users\\me\\AppData\\Local"},
    ) == ["C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data"]


def test_returns_no_root_where_a_browser_does_not_run() -> None:
    assert (
        resolve_browser_roots("chrome-canary", platform="linux", home_dir="/home/me")
        == []
    )
    assert resolve_browser_roots("arc", platform="linux", home_dir="/home/me") == []


def test_marks_opera_style_browsers_as_single_profile() -> None:
    assert is_single_profile_browser("opera") is True
    assert is_single_profile_browser("opera-gx") is True
    assert is_single_profile_browser("chrome") is False
    assert is_single_profile_browser("vivaldi") is False


def test_exposes_safe_storage_identity_for_chromium_and_none_for_firefox() -> None:
    assert safe_storage_identity("brave") == {
        "service": "Brave Safe Storage",
        "application": "brave",
        "folder": "Brave Keys",
    }
    assert safe_storage_identity("firefox") is None


def test_exposes_default_browser_identifiers_per_platform() -> None:
    assert default_browser_identifiers("chrome", "darwin") == ["com.google.chrome"]
    assert default_browser_identifiers("firefox", "win32") == [
        "FirefoxHTML",
        "FirefoxURL",
    ]
    assert default_browser_identifiers("chrome", "nope") == []
