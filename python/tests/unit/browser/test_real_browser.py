"""Tests for launching and attaching to genuine installed browsers."""

from __future__ import annotations

from typing import Any

import pytest

from browser_commander import (
    RealBrowserOptions,
    launch_and_connect_real_browser,
    launch_real_browser,
)
from browser_commander.browser.real_browser import (
    _browser_install_candidates,
    assert_dedicated_user_data_dir,
    build_real_browser_args,
    launch_real_browser_with_dependencies,
)


def test_public_api_exports_compatible_helper_names() -> None:
    assert launch_and_connect_real_browser is launch_real_browser


def test_builds_protected_loopback_command() -> None:
    arguments = build_real_browser_args(
        user_data_dir="/tmp/browser-commander-dedicated",
        remote_debugging_port=9333,
        headless=True,
        args=["--lang=en-US"],
    )

    assert arguments == [
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=9333",
        "--user-data-dir=/tmp/browser-commander-dedicated",
        "--disable-session-crashed-bubble",
        "--hide-crash-restore-bubble",
        "--disable-infobars",
        "--password-store=basic",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-crash-restore",
        "--headless=new",
        "--lang=en-US",
    ]


def test_supports_additive_arguments_and_per_default_opt_out() -> None:
    arguments = build_real_browser_args(
        user_data_dir="/tmp/browser-commander-dedicated",
        args=["--legacy-arg"],
        extra_args=["--lang=en-US"],
        ignore_default_args=["--no-first-run"],
    )

    assert "--password-store=basic" in arguments
    assert "--no-first-run" not in arguments
    assert "--no-default-browser-check" in arguments
    assert arguments[-2:] == ["--legacy-arg", "--lang=en-US"]


def test_rejects_default_profiles_and_managed_arguments(tmp_path: Any) -> None:
    # Keep the simulated Linux paths independent of the host running the test.
    fake_home = "/home/tester"
    with pytest.raises(ValueError, match="dedicated user_data_dir"):
        assert_dedicated_user_data_dir(
            "/home/tester/.config/google-chrome",
            platform="linux",
            home_dir=fake_home,
            environment={},
        )

    with pytest.raises(ValueError, match="managed by launch_real_browser"):
        build_real_browser_args(
            user_data_dir=tmp_path / "dedicated",
            args=["--remote-debugging-port=9222"],
        )


@pytest.mark.parametrize(
    ("platform", "channel", "environment", "expected"),
    [
        (
            "darwin",
            "chrome",
            {"PATH": ""},
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        ),
        (
            "win32",
            "msedge",
            {"PROGRAMFILES": r"C:\Program Files", "PATH": ""},
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ),
        (
            "linux",
            "brave",
            {"PATH": "/custom/bin"},
            "/custom/bin/brave-browser",
        ),
    ],
)
def test_discovers_standard_browser_locations_on_each_platform(
    platform: str,
    channel: str,
    environment: dict[str, str],
    expected: str,
) -> None:
    candidates = _browser_install_candidates(
        channel,
        platform=platform,
        environment=environment,
        home_dir="/Users/tester",
    )

    assert expected in candidates


@pytest.mark.asyncio
async def test_spawns_waits_connects_and_returns_process_metadata(
    tmp_path: Any,
) -> None:
    calls: list[Any] = []

    class FakeProcess:
        returncode = None

        def terminate(self) -> None:
            calls.append(("terminate",))

    process = FakeProcess()
    browser = object()
    page = object()

    async def resolve_executable(**options: Any) -> str:
        calls.append(("resolve", options))
        return "/opt/google/chrome"

    async def spawn_browser(
        executable: str, arguments: list[str], **options: Any
    ) -> Any:
        calls.append(("spawn", executable, arguments, options))
        return process

    async def wait_for_endpoint(**options: Any) -> str:
        calls.append(("wait", options))
        return "http://127.0.0.1:9444"

    async def connect(options: Any) -> Any:
        calls.append(("connect", options))
        from browser_commander.browser.launcher import LaunchResult

        return LaunchResult(browser=browser, page=page)

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(
            engine="selenium",
            channel="chrome",
            user_data_dir=str(tmp_path / "profile"),
            remote_debugging_port=0,
            seed_cookies=[{"name": "SID", "value": "saved"}],
        ),
        resolve_executable=resolve_executable,
        spawn_browser=spawn_browser,
        wait_for_endpoint=wait_for_endpoint,
        connect=connect,
    )

    assert result.browser is browser
    assert result.page is page
    assert result.browser_process is process
    assert result.cdp_endpoint == "http://127.0.0.1:9444"
    assert result.executable_path == "/opt/google/chrome"
    assert result.user_data_dir == str(tmp_path / "profile")
    connect_options = calls[-1][1]
    assert connect_options.engine == "selenium"
    assert connect_options.cdp_endpoint == "http://127.0.0.1:9444"
    assert connect_options.seed_cookies == [{"name": "SID", "value": "saved"}]


@pytest.mark.asyncio
async def test_terminates_spawned_browser_when_connection_fails(tmp_path: Any) -> None:
    terminated = False

    class FakeProcess:
        returncode = None

        def terminate(self) -> None:
            nonlocal terminated
            terminated = True

    async def connect(_options: Any) -> Any:
        raise RuntimeError("connection failed")

    with pytest.raises(RuntimeError, match="connection failed"):
        await launch_real_browser_with_dependencies(
            RealBrowserOptions(user_data_dir=str(tmp_path / "profile")),
            resolve_executable=lambda **_options: "/opt/google/chrome",
            spawn_browser=lambda *_args, **_options: FakeProcess(),
            wait_for_endpoint=lambda **_options: "http://127.0.0.1:9222",
            connect=connect,
        )

    assert terminated
