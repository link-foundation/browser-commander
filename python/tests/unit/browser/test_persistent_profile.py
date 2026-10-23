"""A persistent profile keeps its session cookies across restarts (#187)."""

# feature-parity: profile.session-cookies@native-typed

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

import browser_commander
from browser_commander.browser import persistent_session
from browser_commander.browser.launcher import (
    LaunchOptions,
    LaunchResult,
    launch_browser_with_dependencies,
)
from browser_commander.browser.persistent_profile import (
    CONTINUE_SESSION_FEATURE,
    KEEP_SESSION_COOKIES_SWITCH,
    SESSION_RESTORE_FILES,
    clear_restored_tabs,
    persistent_profile_args,
    prepare_session_restore,
    resolve_keep_session_cookies,
)
from browser_commander.browser.real_browser import (
    RealBrowserOptions,
    build_real_browser_args,
    launch_real_browser_with_dependencies,
)
from browser_commander.browser.safari_webdriver import launch_safari
from tests.unit.browser.test_launch_browser import engine_dependencies
from tests.unit.browser.test_real_browser import FakeProcess, _executable

OPT_OUT = f"--disable-features={CONTINUE_SESSION_FEATURE}"


def test_persistent_profile_args_keep_session_cookies_by_default() -> None:
    assert persistent_profile_args() == ["--restore-last-session"]
    assert KEEP_SESSION_COOKIES_SWITCH == "--restore-last-session"
    assert persistent_profile_args(keep_session_cookies=True) == [
        "--restore-last-session"
    ]


def test_persistent_profile_args_turn_the_continue_session_default_off() -> None:
    assert persistent_profile_args(keep_session_cookies=False) == [
        "--disable-features=SessionRestoreInfobar"
    ]


def test_persistent_profile_args_refuse_a_non_boolean_choice() -> None:
    with pytest.raises(TypeError, match="keep_session_cookies must be a boolean"):
        persistent_profile_args(keep_session_cookies="yes")  # type: ignore[arg-type]


def test_resolve_keeps_them_for_a_persistent_profile_only() -> None:
    assert resolve_keep_session_cookies(None, temporary_profile=False) is True
    # A temporary profile keeps today's command line.
    assert resolve_keep_session_cookies(None, temporary_profile=True) is None
    for temporary_profile in (True, False):
        assert (
            resolve_keep_session_cookies(False, temporary_profile=temporary_profile)
            is False
        )
        assert (
            resolve_keep_session_cookies(True, temporary_profile=temporary_profile)
            is True
        )


def _last_session(profile: Path) -> None:
    (profile / "Sessions").mkdir(parents=True)
    (profile / "Sessions" / "Session_1").write_text("tabs")
    (profile / "Current Session").write_text("legacy")
    (profile / "Cookies").write_text("cookie store")


def test_clear_restored_tabs_deletes_the_last_session_and_keeps_cookies(
    tmp_path: Path,
) -> None:
    _last_session(tmp_path / "Default")
    clear_restored_tabs(tmp_path)
    assert not (tmp_path / "Default" / "Sessions").exists()
    assert not (tmp_path / "Default" / "Current Session").exists()
    assert (tmp_path / "Default" / "Cookies").read_text() == "cookie store"
    assert "Cookies" not in SESSION_RESTORE_FILES
    # A profile that never ran has nothing to delete.
    clear_restored_tabs(tmp_path / "missing")


def test_clear_restored_tabs_follows_profile_directory_and_refuses_paths(
    tmp_path: Path,
) -> None:
    _last_session(tmp_path / "Profile 1")
    prepare_session_restore(
        tmp_path,
        keep_session_cookies=True,
        args=["--profile-directory=Profile 1"],
    )
    assert not (tmp_path / "Profile 1" / "Sessions").exists()
    for name in ("../outside", "/etc", "", ".."):
        with pytest.raises(ValueError, match="profile directory name"):
            clear_restored_tabs(tmp_path, profile_directory=name)


@pytest.mark.parametrize(
    "options",
    [
        {"keep_session_cookies": True, "restore_tabs": True},
        {"keep_session_cookies": False},
        {"keep_session_cookies": None},
    ],
)
def test_prepare_session_restore_is_skipped_unless_tabs_are_dropped(
    tmp_path: Path, options: dict[str, Any]
) -> None:
    _last_session(tmp_path / "Default")
    prepare_session_restore(tmp_path, **options)
    assert (tmp_path / "Default" / "Sessions" / "Session_1").is_file()


def test_build_real_browser_args_adds_the_switch_before_custom_args_once() -> None:
    arguments = build_real_browser_args(
        user_data_dir="/p",
        remote_debugging_port=9222,
        keep_session_cookies=True,
        args=["--lang=en"],
    )
    assert arguments.count("--restore-last-session") == 1
    assert arguments.index("--restore-last-session") < arguments.index("--lang=en")
    duplicate = build_real_browser_args(
        user_data_dir="/p",
        remote_debugging_port=9222,
        keep_session_cookies=True,
        args=["--restore-last-session"],
    )
    assert duplicate.count("--restore-last-session") == 1


def test_build_real_browser_args_adds_nothing_when_unset() -> None:
    arguments = build_real_browser_args(user_data_dir="/p", remote_debugging_port=9222)
    assert "--restore-last-session" not in arguments
    assert not any(CONTINUE_SESSION_FEATURE in argument for argument in arguments)


def _real_dependencies(spawned: list[list[str]]) -> dict[str, Any]:
    def spawn_browser(_executable: str, arguments: list[str], **_options: Any) -> Any:
        spawned.append(arguments)
        return FakeProcess([])

    async def wait_for_endpoint(**_options: Any) -> str:
        return "http://127.0.0.1:9444"

    async def connect(_options: Any) -> Any:
        return LaunchResult(browser=object(), page=object())

    return {
        "resolve_executable": _executable,
        "reserve_port": lambda: 9444,
        "spawn_browser": spawn_browser,
        "wait_for_endpoint": wait_for_endpoint,
        "connect": connect,
    }


async def test_launch_real_browser_keeps_them_and_starts_with_one_tab(
    tmp_path: Path,
) -> None:
    _last_session(tmp_path / "Default")
    spawned: list[list[str]] = []
    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(user_data_dir=str(tmp_path)), **_real_dependencies(spawned)
    )
    assert "--restore-last-session" in spawned[0]
    assert result.keep_session_cookies is True
    assert result.warnings == []
    assert not (tmp_path / "Default" / "Sessions").exists()
    assert (tmp_path / "Default" / "Cookies").is_file()


async def test_launch_real_browser_keeps_the_last_tabs_with_restore_tabs(
    tmp_path: Path,
) -> None:
    _last_session(tmp_path / "Default")
    spawned: list[list[str]] = []
    await launch_real_browser_with_dependencies(
        RealBrowserOptions(user_data_dir=str(tmp_path), restore_tabs=True),
        **_real_dependencies(spawned),
    )
    assert "--restore-last-session" in spawned[0]
    assert (tmp_path / "Default" / "Sessions" / "Session_1").is_file()


async def test_launch_real_browser_opt_out_lets_chromium_delete_them(
    tmp_path: Path,
) -> None:
    spawned: list[list[str]] = []
    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(user_data_dir=str(tmp_path), keep_session_cookies=False),
        **_real_dependencies(spawned),
    )
    assert "--restore-last-session" not in spawned[0]
    assert OPT_OUT in spawned[0]
    assert result.keep_session_cookies is False


async def test_launch_real_browser_leaves_a_temporary_profile_as_it_was() -> None:
    spawned: list[list[str]] = []
    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(), **_real_dependencies(spawned)
    )
    assert result.temporary_profile is True
    assert result.keep_session_cookies is False
    assert "--restore-last-session" not in spawned[0]
    assert not any(CONTINUE_SESSION_FEATURE in argument for argument in spawned[0])
    await result.close()


async def test_launch_real_browser_refuses_a_non_boolean_before_starting() -> None:
    spawned: list[list[str]] = []
    with pytest.raises(TypeError, match="restore_tabs must be a boolean"):
        await launch_real_browser_with_dependencies(
            RealBrowserOptions(restore_tabs="yes"),  # type: ignore[arg-type]
            **_real_dependencies(spawned),
        )
    assert spawned == []


async def test_engine_launch_keeps_them_on_the_full_chromium_build_headless(
    tmp_path: Path,
) -> None:
    _last_session(tmp_path / "Default")
    calls: list[Any] = []
    result = await launch_browser_with_dependencies(
        LaunchOptions(launch="engine", user_data_dir=str(tmp_path), headless=True),
        engine_dependencies(calls),
    )
    options = calls[0][2]
    assert options["args"][0] == "--restore-last-session"
    # chromium-headless-shell deletes them even with the switch.
    assert options["channel"] == "chromium"
    assert result.keep_session_cookies is True
    assert result.warnings == []
    assert not (tmp_path / "Default" / "Sessions").exists()
    assert result.close is not None
    await result.close()


async def test_engine_launch_warns_when_the_headless_shell_cannot_keep_them(
    tmp_path: Path,
) -> None:
    calls: list[Any] = []
    result = await launch_browser_with_dependencies(
        LaunchOptions(
            launch="engine",
            user_data_dir=str(tmp_path),
            channel="chromium-headless-shell",
            headless=True,
        ),
        engine_dependencies(calls),
    )
    assert calls[0][2]["channel"] == "chromium-headless-shell"
    assert [warning["reason"] for warning in result.warnings] == ["headless-shell"]
    assert result.warnings[0]["item"] == "keep_session_cookies"
    assert result.close is not None
    await result.close()


async def test_engine_launch_changes_nothing_for_a_temporary_profile_or_opt_out(
    tmp_path: Path,
) -> None:
    calls: list[Any] = []
    temporary = await launch_browser_with_dependencies(
        LaunchOptions(launch="engine"), engine_dependencies(calls)
    )
    assert calls[0][2]["args"] == ["--disable-blink-features=AutomationControlled"]
    assert "channel" not in calls[0][2]
    assert temporary.keep_session_cookies is False
    assert temporary.close is not None
    await temporary.close()

    calls.clear()
    opted_out = await launch_browser_with_dependencies(
        LaunchOptions(
            launch="engine", user_data_dir=str(tmp_path), keep_session_cookies=False
        ),
        engine_dependencies(calls),
    )
    assert OPT_OUT in calls[0][2]["args"]
    assert "--restore-last-session" not in calls[0][2]["args"]
    assert "channel" not in calls[0][2]
    assert opted_out.keep_session_cookies is False
    assert opted_out.close is not None
    await opted_out.close()


async def test_selenium_engine_launch_passes_the_switch_to_chrome(
    tmp_path: Path,
) -> None:
    created: list[Any] = []

    def create_selenium(chrome_options: Any, _service_env: Any) -> Any:
        created.append(chrome_options)
        return MagicMock()

    result = await launch_browser_with_dependencies(
        LaunchOptions(engine="selenium", launch="engine", user_data_dir=str(tmp_path)),
        {"create_selenium": create_selenium, "settle_seconds": 0},
    )
    assert "--restore-last-session" in created[0].arguments
    assert result.keep_session_cookies is True
    assert result.close is not None
    await result.close()


async def test_safari_warns_that_it_has_no_profile_directory() -> None:
    driver = MagicMock()
    driver.capabilities = {"browserName": "safari"}
    driver.current_url = "about:blank"
    dependencies = {"platform": "darwin", "create_safari": lambda *_: driver}
    kept = await launch_safari(
        LaunchOptions(channel="safari", keep_session_cookies=True), dependencies
    )
    assert [warning["reason"] for warning in kept.warnings] == [
        "safari-no-profile-directory"
    ]
    assert kept.keep_session_cookies is False
    await kept.close()
    quiet = await launch_safari(LaunchOptions(channel="safari"), dependencies)
    assert quiet.warnings == []
    await quiet.close()


async def test_persistent_session_reports_what_the_worker_launched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(persistent_session, "_worker", AsyncMock())
    page = SimpleNamespace(context=SimpleNamespace(pages=[]))
    connection = SimpleNamespace(
        browser=SimpleNamespace(close=AsyncMock()), page=page, downloads=None
    )
    session = persistent_session.PersistentSession(
        connection,
        {
            "userDataDir": "/tmp/dedicated-profile",
            "remoteDebuggingPort": 9222,
            "cdpEndpoint": "http://127.0.0.1:9222",
            "reused": False,
            "targetId": "target",
            "keepSessionCookies": True,
            "warnings": [{"item": "keepSessionCookies", "reason": "r", "detail": "d"}],
        },
    )
    assert session.keep_session_cookies is True
    assert session.warnings == [
        {"item": "keep_session_cookies", "reason": "r", "detail": "d"}
    ]
    await session.detach()


async def test_connect_or_launch_forwards_the_choice_to_the_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    worker = AsyncMock(side_effect=RuntimeError("stop after the payload"))
    monkeypatch.setattr(persistent_session, "_worker", worker)
    with pytest.raises(RuntimeError, match="stop after the payload"):
        await persistent_session.connect_or_launch(
            user_data_dir="/tmp/p", keep_session_cookies=False, restore_tabs=True
        )
    payload = worker.call_args.args[0]
    assert payload["keepSessionCookies"] is False
    assert payload["restoreTabs"] is True


def test_public_api_exports_the_persistent_profile_helpers() -> None:
    for name in (
        "persistent_profile_args",
        "clear_restored_tabs",
        "prepare_session_restore",
        "KEEP_SESSION_COOKIES_SWITCH",
        "CONTINUE_SESSION_FEATURE",
        "FIREFOX_KEEP_SESSION_COOKIES_PREFERENCES",
        "SESSION_RESTORE_FILES",
    ):
        assert name in browser_commander.__all__
        assert getattr(browser_commander, name) is not None
