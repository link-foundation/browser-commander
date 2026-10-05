"""Profile discovery parity for the expanded catalogue (#114).

Mirrors ``js/tests/unit/browser/browser-profiles-sources.test.js``.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path

import pytest

from browser_commander.browser.browser_profiles import (
    BrowserProfile,
    list_browser_profiles,
    resolve_browser_profile,
    resolve_source_browser,
)
from tests.helpers.migration_fixtures import write_firefox_profile

_COOKIES = [{"name": "a", "value": "1", "host": ".example.com"}]


def test_reads_an_opera_single_profile_layout_from_the_root_itself(
    tmp_path: Path,
) -> None:
    root = tmp_path / ".config" / "opera"
    root.mkdir(parents=True)
    cookie_path = root / "Network" / "Cookies"
    cookie_path.parent.mkdir(parents=True)
    cookie_path.write_bytes(b"SQLite format 3\x00")

    profiles = list_browser_profiles(
        "opera", platform="linux", home_dir=tmp_path, environment={}
    )

    assert profiles == [
        BrowserProfile(
            browser="opera",
            name="Default",
            display_name="Default",
            path=root,
            is_default=True,
        )
    ]


def test_discovers_a_firefox_fork_librewolf_by_its_own_root(tmp_path: Path) -> None:
    profile_path = write_firefox_profile(
        tmp_path, _COOKIES, root=".librewolf", name="default"
    )

    profiles = list_browser_profiles("librewolf", platform="linux", home_dir=tmp_path)

    assert profiles == [
        BrowserProfile(
            browser="librewolf",
            name="default",
            display_name="default",
            path=profile_path,
            is_default=True,
        )
    ]


def test_lists_firefox_once_when_its_channels_share_a_root(tmp_path: Path) -> None:
    write_firefox_profile(tmp_path, _COOKIES)

    profiles = list_browser_profiles(platform="linux", home_dir=tmp_path)

    assert [profile.browser for profile in profiles] == ["firefox"]


def test_resolves_browser_default_to_the_system_default_browser() -> None:
    def run_command(
        command: str, args: Sequence[str], _environment: Mapping[str, str]
    ) -> str:
        if command == "xdg-settings" and " ".join(args) == "get default-web-browser":
            return "firefox.desktop\n"
        raise RuntimeError("unexpected command")

    assert (
        resolve_source_browser(
            "default", platform="linux", environment={}, run_command=run_command
        )
        == "firefox"
    )
    assert (
        resolve_source_browser(
            "AUTO", platform="linux", environment={}, run_command=run_command
        )
        == "firefox"
    )


def test_lists_the_default_browser_profile_when_browser_is_default(
    tmp_path: Path,
) -> None:
    profile_path = write_firefox_profile(tmp_path, _COOKIES)

    def run_command(
        _command: str, _args: Sequence[str], _environment: Mapping[str, str]
    ) -> str:
        return "firefox.desktop\n"

    resolved = resolve_browser_profile(
        "default",
        None,
        platform="linux",
        home_dir=tmp_path,
        environment={},
        run_command=run_command,
    )
    assert resolved.browser == "firefox"
    assert resolved.path == profile_path

    profiles = list_browser_profiles(
        "auto",
        platform="linux",
        home_dir=tmp_path,
        environment={},
        run_command=run_command,
    )
    assert [profile.browser for profile in profiles] == ["firefox"]


def test_reports_a_clear_error_when_the_default_browser_is_unknown() -> None:
    def failing(
        _command: str, _args: Sequence[str], _environment: Mapping[str, str]
    ) -> str:
        raise RuntimeError("no xdg")

    with pytest.raises(
        ValueError, match=r"Could not determine the system default browser"
    ):
        resolve_source_browser(
            "default", platform="linux", environment={}, run_command=failing
        )
