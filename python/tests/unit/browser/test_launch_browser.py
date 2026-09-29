"""launch_browser: real launch by default, engine launch on request (#101, #103)."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, ClassVar

import pytest

import browser_commander
from browser_commander.browser.launcher import (
    LaunchOptions,
    launch_browser,
    launch_browser_with_dependencies,
    resolve_launch_executable,
)
from browser_commander.browser.profile_directory import TEMPORARY_PROFILE_PREFIX
from browser_commander.browser.real_browser import RealBrowserResult


class FakePage:
    def __init__(self, calls: list[Any]) -> None:
        self.calls = calls

    async def bring_to_front(self) -> None:
        self.calls.append(("bring_to_front",))

    async def emulate_media(self, **options: Any) -> None:
        self.calls.append(("emulate_media", options))


class FakeContext:
    def __init__(self, calls: list[Any], page: FakePage) -> None:
        self.calls = calls
        self.pages = [page]

    async def close(self) -> None:
        self.calls.append(("context.close",))


def fake_real_launcher(calls: list[Any]) -> Any:
    """A launch_real_browser stand-in that records what it was asked for."""

    async def launch(options: Any) -> RealBrowserResult:
        calls.append(("launch_real_browser", options))
        page = FakePage(calls)
        context = FakeContext(calls, page)

        class Browser:
            contexts: ClassVar[list[Any]] = [context]

        async def close() -> None:
            calls.append(("close",))

        return RealBrowserResult(
            browser=Browser(),
            page=page,
            close=close,
            user_data_dir="/tmp/browser-commander-profile-x",
            temporary_profile=True,
            args=["--user-data-dir=/tmp/browser-commander-profile-x"],
        )

    return launch


def system_chrome(**_options: Any) -> str:
    return "/usr/bin/google-chrome"


def real_dependencies(calls: list[Any]) -> dict[str, Any]:
    return {
        "launch_real_browser": fake_real_launcher(calls),
        "resolve_system": system_chrome,
        "settle_seconds": 0,
    }


async def test_starts_the_real_browser_by_default_with_nothing_added(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    calls: list[Any] = []

    result = await launch_browser_with_dependencies(
        LaunchOptions(), real_dependencies(calls)
    )

    options = next(call[1] for call in calls if call[0] == "launch_real_browser")
    assert options.engine == "playwright"
    assert options.executable_path == "/usr/bin/google-chrome"
    assert options.slow_mo is None
    assert options.user_data_dir is None
    assert options.remote_debugging_port is None
    assert options.restrictions == []
    assert options.args == []
    assert result.launch == "real"
    assert result.temporary_profile is True
    # The host process environment is never changed.
    assert "GOOGLE_API_KEY" not in os.environ

    # Playwright gets the attached default context, like the persistent context
    # it used to get, and closing it closes the browser.
    assert isinstance(result.browser, FakeContext)
    await result.browser.close()
    assert calls[-1] == ("close",)


async def test_forwards_restrictions_and_slow_mo_to_the_real_launch() -> None:
    calls: list[Any] = []
    result = await launch_browser_with_dependencies(
        LaunchOptions(restrictions=["no-sync"], slow_mo=20),
        real_dependencies(calls),
    )

    options = calls[0][1]
    assert options.restrictions == ["no-sync"]
    assert options.slow_mo == 20
    assert result.close is not None
    await result.close()
    assert calls[-1] == ("close",)


async def test_emulates_the_colour_scheme_on_the_attached_page() -> None:
    calls: list[Any] = []
    await launch_browser_with_dependencies(
        LaunchOptions(color_scheme="dark"), real_dependencies(calls)
    )

    assert ("emulate_media", {"color_scheme": "dark"}) in calls


async def test_closes_the_browser_when_post_launch_setup_fails() -> None:
    calls: list[Any] = []
    # The fake page cannot open a CDP session, so applying the profile fails.
    with pytest.raises(AttributeError):
        await launch_browser_with_dependencies(
            LaunchOptions(fingerprint={"timezoneId": "Europe/Berlin"}),
            real_dependencies(calls),
        )
    assert calls[-1] == ("close",)


async def test_rejects_invalid_options_before_launching() -> None:
    with pytest.raises(ValueError, match="Invalid engine: invalid-engine"):
        await launch_browser(LaunchOptions(engine="invalid-engine"))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="Invalid launch mode: attach"):
        await launch_browser(LaunchOptions(launch="attach"))  # type: ignore[arg-type]
    with pytest.raises(ValueError, match='Unknown launch restriction "no-such"'):
        await launch_browser(LaunchOptions(restrictions=["no-such"]))


class FakePlaywright:
    def __init__(self, calls: list[Any]) -> None:
        self.calls = calls
        self.chromium = self

    async def launch_persistent_context(
        self, user_data_dir: str, **options: Any
    ) -> FakeContext:
        self.calls.append(("launch_persistent_context", user_data_dir, options))
        return FakeContext(self.calls, FakePage(self.calls))

    async def stop(self) -> None:
        self.calls.append(("playwright.stop",))


def engine_dependencies(calls: list[Any]) -> dict[str, Any]:
    async def start_playwright() -> FakePlaywright:
        return FakePlaywright(calls)

    return {"start_playwright": start_playwright, "settle_seconds": 0}


async def test_engine_launch_uses_a_temporary_profile_deleted_on_close() -> None:
    calls: list[Any] = []
    result = await launch_browser_with_dependencies(
        LaunchOptions(launch="engine"), engine_dependencies(calls)
    )

    _, user_data_dir, options = calls[0]
    assert Path(user_data_dir).name.startswith(TEMPORARY_PROFILE_PREFIX)
    assert Path(user_data_dir).is_dir()
    assert options["slow_mo"] == 0
    # Only the automation off switch the engine launch needs; none of the
    # pre-#103 CHROME_ARGS.
    assert options["args"] == ["--disable-blink-features=AutomationControlled"]
    assert "env" not in options
    assert result.launch == "engine"
    assert result.temporary_profile is True

    await result.browser.close()
    assert calls[-2:] == [("context.close",), ("playwright.stop",)]
    assert not Path(user_data_dir).exists()


async def test_engine_launch_passes_restriction_environment_to_the_browser_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    calls: list[Any] = []
    result = await launch_browser_with_dependencies(
        LaunchOptions(launch="engine", restrictions=["legacy-launch-browser"]),
        engine_dependencies(calls),
    )

    options = calls[0][2]
    assert options["env"]["GOOGLE_API_KEY"] == "no"
    assert "GOOGLE_API_KEY" not in os.environ
    assert "--no-first-run" in options["args"]
    assert "--disable-features=Translate" in options["args"]
    assert result.close is not None
    await result.close()


async def test_engine_launch_keeps_a_caller_profile(tmp_path: Path) -> None:
    calls: list[Any] = []
    result = await launch_browser_with_dependencies(
        LaunchOptions(launch="engine", user_data_dir=str(tmp_path)),
        engine_dependencies(calls),
    )
    assert calls[0][1] == str(tmp_path)
    assert result.temporary_profile is False
    assert result.close is not None
    await result.close()
    assert tmp_path.is_dir()


async def test_selenium_engine_launch_passes_the_environment_to_the_service() -> None:
    created: list[Any] = []

    class Driver:
        def quit(self) -> None:
            created.append(("quit",))

    def create_selenium(chrome_options: Any, service_env: Any) -> Driver:
        created.append((chrome_options, service_env))
        return Driver()

    result = await launch_browser_with_dependencies(
        LaunchOptions(
            engine="selenium", launch="engine", restrictions=["no-google-services"]
        ),
        {"create_selenium": create_selenium, "settle_seconds": 0},
    )

    chrome_options, service_env = created[0]
    assert service_env["GOOGLE_API_KEY"] == "no"
    assert any(arg.startswith("--user-data-dir=") for arg in chrome_options.arguments)
    assert chrome_options.experimental_options["excludeSwitches"] == [
        "enable-automation"
    ]
    assert result.close is not None
    await result.close()
    assert created[-1] == ("quit",)
    assert result.user_data_dir is not None
    assert not Path(result.user_data_dir).exists()


async def test_resolve_launch_executable_honours_channel_and_path() -> None:
    requests: list[Any] = []

    def resolve_system(**request: Any) -> str:
        requests.append(request)
        return "/resolved"

    await resolve_launch_executable(
        engine="playwright", channel="msedge", resolve_system=resolve_system
    )
    await resolve_launch_executable(
        engine="playwright",
        executable_path="/opt/chrome",
        resolve_system=resolve_system,
    )
    assert requests == [
        {"channel": "msedge", "executable_path": None},
        {"channel": "chrome", "executable_path": "/opt/chrome"},
    ]


async def test_resolve_launch_executable_falls_back_to_the_bundled_chromium() -> None:
    def not_installed(**_request: Any) -> str:
        raise FileNotFoundError("Chrome is not installed")

    executable = await resolve_launch_executable(
        engine="playwright",
        resolve_system=not_installed,
        bundled_executable=lambda _engine: sys.executable,
    )
    assert executable == sys.executable

    with pytest.raises(FileNotFoundError, match="Chrome is not installed"):
        await resolve_launch_executable(
            engine="playwright",
            resolve_system=not_installed,
            bundled_executable=lambda _engine: "/nonexistent/chrome",
        )


def test_public_api_exports_the_launch_modes_restrictions_and_helpers() -> None:
    api = browser_commander
    assert api.LAUNCH_MODES == ("real", "engine")
    assert any(entry["id"] == "no-sync" for entry in api.LAUNCH_RESTRICTIONS)
    assert api.LAUNCH_RESTRICTION_PRESETS["legacy-defaults"]
    for name in [
        "resolve_restrictions",
        "merge_feature_switches",
        "browser_environment",
        "resolve_launch_executable",
        "create_temporary_user_data_dir",
        "prepare_user_data_dir",
        "remove_user_data_dir",
        "reserve_loopback_port",
        "assert_fixed_debugging_port",
        "build_real_browser_args",
        "pick_foreground_page",
        "PortRaceError",
        "CommandError",
        "ManagedProcess",
        "run_command",
        "start_process",
    ]:
        assert callable(getattr(api, name)), name
        assert name in api.__all__, name
