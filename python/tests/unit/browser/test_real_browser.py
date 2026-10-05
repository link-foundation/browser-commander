"""Tests for launching and attaching to genuine installed browsers."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

import pytest

from browser_commander import (
    RealBrowserOptions,
    launch_and_connect_real_browser,
    launch_real_browser,
)
from browser_commander.browser.debugging_port import PortRaceError
from browser_commander.browser.launcher import LaunchResult
from browser_commander.browser.profile_directory import TEMPORARY_PROFILE_PREFIX
from browser_commander.browser.real_browser import (
    START_URL,
    _browser_install_candidates,
    assert_dedicated_user_data_dir,
    build_real_browser_args,
    launch_real_browser_with_dependencies,
    wait_for_cdp_endpoint,
)
from browser_commander.fingerprint.automation_parity import (
    detect_automation_controlled_triggers,
    disables_automation_controlled,
)
from browser_commander.utilities.subprocess import OutputChannel

# feature-parity: migration.launch@native-typed
DEDICATED = "/tmp/browser-commander-dedicated"


class FakeProcess:
    """A spawned browser stand-in with the ManagedProcess surface."""

    def __init__(self, calls: list[Any]) -> None:
        self.calls = calls
        self.exit_code: int | None = None
        self._listeners: list[Any] = []

    def kill(self) -> None:
        self.calls.append(("kill",))
        self.exit(143)

    def once(self, event: str, listener: Any) -> None:
        if self.exit_code is None:
            self._listeners.append(listener)
        else:
            listener(self.exit_code)

    def exit(self, code: int) -> None:
        self.exit_code = code
        listeners, self._listeners = self._listeners, []
        for listener in listeners:
            listener(code)


def _executable(**_options: Any) -> str:
    return "/opt/google/chrome"


def _connected(browser: Any = None, page: Any = None) -> Any:
    async def connect(_options: Any) -> LaunchResult:
        return LaunchResult(browser=browser, page=page)

    return connect


def test_public_api_exports_compatible_helper_names() -> None:
    assert launch_and_connect_real_browser is launch_real_browser


def test_builds_exactly_the_command_line_a_person_would_type() -> None:
    # Issue #103: nothing but the dedicated profile and a fixed port.
    assert build_real_browser_args(
        user_data_dir=DEDICATED, remote_debugging_port=9333
    ) == [f"--user-data-dir={DEDICATED}", "--remote-debugging-port=9333", START_URL]


def test_opens_a_blank_tab_unless_the_caller_passes_a_start_url() -> None:
    arguments = build_real_browser_args(
        user_data_dir=DEDICATED,
        remote_debugging_port=9333,
        args=["--lang=en-US", "https://example.com/"],
    )
    assert arguments[-1] == "https://example.com/"
    assert START_URL not in arguments


def test_never_turns_automation_controlled_on_in_a_headful_launch() -> None:
    # Issue #101: the guard that keeps navigator.webdriver false.
    arguments = build_real_browser_args(
        user_data_dir=DEDICATED,
        remote_debugging_port=9333,
        restrictions=["legacy-defaults", "no-extensions", "no-translate"],
        args=["--lang=en-US"],
    )
    assert detect_automation_controlled_triggers(arguments) == []
    # ...so the switch that shows the unsupported-flag infobar is not needed.
    assert disables_automation_controlled(arguments) is False


@pytest.mark.parametrize("port", [0, -1, 65_536, True, "9222"])
def test_refuses_port_zero_and_invalid_ports(port: Any) -> None:
    with pytest.raises(ValueError, match=r"AutomationControlled|1 to 65535"):
        build_real_browser_args(user_data_dir=DEDICATED, remote_debugging_port=port)
    with pytest.raises(ValueError, match="AutomationControlled"):
        build_real_browser_args(user_data_dir=DEDICATED, remote_debugging_port=0)


def test_launches_headless_exactly_as_a_person_would_with_no_off_switch() -> None:
    # A hand-started headless Chrome reports navigator.webdriver false, so the
    # off switch would only be a command-line difference of its own.
    assert build_real_browser_args(
        user_data_dir=DEDICATED, remote_debugging_port=9333, headless=True
    ) == [
        f"--user-data-dir={DEDICATED}",
        "--remote-debugging-port=9333",
        "--headless=new",
        START_URL,
    ]


def test_adds_the_off_switch_when_a_custom_argument_is_a_trigger() -> None:
    assert build_real_browser_args(
        user_data_dir=DEDICATED,
        remote_debugging_port=9333,
        args=["--disable-blink-features=Foo", "--enable-automation"],
    ) == [
        f"--user-data-dir={DEDICATED}",
        "--remote-debugging-port=9333",
        "--disable-blink-features=Foo,AutomationControlled",
        "--enable-automation",
        START_URL,
    ]
    assert "--disable-blink-features=AutomationControlled" not in (
        build_real_browser_args(
            user_data_dir=DEDICATED,
            remote_debugging_port=9333,
            args=["--enable-automation"],
            automation_parity=False,
        )
    )


def test_applies_opt_in_restrictions_and_merges_feature_lists() -> None:
    assert build_real_browser_args(
        user_data_dir=DEDICATED,
        remote_debugging_port=9333,
        restrictions=["no-sync", "no-translate"],
        args=["--legacy-arg", "--disable-features=Foo"],
        extra_args=["--lang=en-US"],
    ) == [
        f"--user-data-dir={DEDICATED}",
        "--remote-debugging-port=9333",
        "--disable-sync",
        "--disable-features=Translate,Foo",
        "--legacy-arg",
        "--lang=en-US",
        START_URL,
    ]
    with pytest.raises(ValueError, match="Unknown launch restriction"):
        build_real_browser_args(
            user_data_dir=DEDICATED,
            remote_debugging_port=9333,
            restrictions=["no-such-thing"],
        )


@pytest.mark.parametrize(
    "argument",
    [
        "--remote-debugging-address=0.0.0.0",
        "--remote-debugging-port=9222",
        "--remote-debugging-pipe",
        "--user-data-dir=/tmp/other",
    ],
)
def test_rejects_arguments_that_bypass_protected_cdp_settings(argument: str) -> None:
    with pytest.raises(ValueError, match="managed by launch_real_browser"):
        build_real_browser_args(
            user_data_dir=DEDICATED, remote_debugging_port=9333, args=[argument]
        )


def test_rejects_a_bare_string_for_args() -> None:
    with pytest.raises(TypeError, match="args must be a list of strings"):
        build_real_browser_args(
            user_data_dir=DEDICATED,
            remote_debugging_port=9333,
            args="--lang=en-US",  # type: ignore[arg-type]
        )


@pytest.mark.parametrize("profile", ["google-chrome", "google-chrome-beta"])
def test_rejects_chrome_default_user_data_directories(profile: str) -> None:
    # Keep the simulated Linux paths independent of the host running the test.
    with pytest.raises(ValueError, match="dedicated user_data_dir"):
        assert_dedicated_user_data_dir(
            f"/home/tester/.config/{profile}",
            platform="linux",
            home_dir="/home/tester",
            environment={},
        )


@pytest.mark.parametrize("channel", ["firefox", "librewolf", "safari", "duckduckgo"])
def test_cdp_validation_rejects_other_protocols(channel: str) -> None:
    from browser_commander.browser.real_browser import _validate_launch_request

    with pytest.raises(ValueError, match="does not support CDP"):
        _validate_launch_request(RealBrowserOptions(channel=channel))


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


async def test_spawns_waits_connects_and_returns_process_metadata(
    tmp_path: Path,
) -> None:
    calls: list[Any] = []
    process = FakeProcess(calls)
    browser = object()
    page = object()
    profile = str(tmp_path / "profile")

    def spawn_browser(executable: str, arguments: list[str], **options: Any) -> Any:
        calls.append(("spawn", executable, arguments, options))
        return process

    async def wait_for_endpoint(**options: Any) -> str:
        calls.append(("wait", options["remote_debugging_port"]))
        return "http://127.0.0.1:9444"

    async def connect(options: Any) -> Any:
        calls.append(("connect", options))
        return LaunchResult(browser=browser, page=page)

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(
            engine="selenium",
            channel="chrome",
            user_data_dir=profile,
            seed_cookies=[{"name": "SID", "value": "saved"}],
        ),
        resolve_executable=_executable,
        reserve_port=lambda: 9444,
        spawn_browser=spawn_browser,
        wait_for_endpoint=wait_for_endpoint,
        connect=connect,
    )

    assert result.browser is browser
    assert result.page is page
    assert result.browser_process is process
    assert result.cdp_endpoint == "http://127.0.0.1:9444"
    assert result.remote_debugging_port == 9444
    assert result.executable_path == "/opt/google/chrome"
    assert result.user_data_dir == profile
    assert result.temporary_profile is False
    assert calls[0] == (
        "spawn",
        "/opt/google/chrome",
        [f"--user-data-dir={profile}", "--remote-debugging-port=9444", START_URL],
        {"env": None, "verbose": False},
    )
    assert calls[1] == ("wait", 9444)
    connect_options = calls[2][1]
    assert connect_options.engine == "selenium"
    assert connect_options.cdp_endpoint == "http://127.0.0.1:9444"
    assert connect_options.seed_cookies == [{"name": "SID", "value": "saved"}]
    # First-run UI is suppressed with Chrome's own sentinel, not a switch.
    assert (Path(profile) / "First Run").is_file()
    assert result.close is not None


async def test_migrates_a_profile_before_launch_and_seeds_migrated_cookies(
    tmp_path: Path,
) -> None:
    calls: list[Any] = []
    process = FakeProcess(calls)
    profile = str(tmp_path / "profile")
    migrate_options: dict[str, Any] = {}
    connect_options: list[Any] = []

    async def migrate_profile(**options: Any) -> dict[str, Any]:
        migrate_options.update(options)
        # Migration runs before the browser is spawned.
        assert calls == []
        return {
            "source": {"browser": "chrome", "profile": "Default", "userDataDir": None},
            "target": options["to"],
            "migrated": {
                "cookies": 1,
                "bookmarks": 2,
                "history": 0,
                "passwords": 0,
                "preferences": 0,
                "extensions": 0,
            },
            "skipped": [],
            "warnings": [],
            "cookies": [{"name": "SID", "value": "migrated", "domain": ".google.com"}],
        }

    def spawn_browser(*_args: Any, **_options: Any) -> Any:
        calls.append(("spawn",))
        return process

    async def connect(options: Any) -> Any:
        connect_options.append(options)
        return LaunchResult(browser=object(), page=object())

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(
            engine="playwright",
            channel="chrome",
            user_data_dir=profile,
            seed_cookies=[{"name": "existing", "value": "keep"}],
            migrate_from={
                "browser": "chrome",
                "profile": "Default",
                "include": ["cookies", "bookmarks"],
                "domains": ["google.com"],
                "password_csv": "/tmp/safari-export.csv",
                "include_payment_cards": True,
            },
        ),
        resolve_executable=_executable,
        reserve_port=lambda: 9445,
        spawn_browser=spawn_browser,
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:9445",
        connect=connect,
        migrate_profile=migrate_profile,
    )

    # Migration targets the Default profile directory and receives the
    # launching channel as the target browser for key derivation.
    assert migrate_options["to"] == str(Path(profile) / "Default")
    assert migrate_options["target_browser"] == "chrome"
    assert migrate_options["include"] == ["cookies", "bookmarks"]
    assert migrate_options["domains"] == ["google.com"]
    assert migrate_options["password_csv"] == "/tmp/safari-export.csv"
    assert migrate_options["include_payment_cards"] is True
    assert migrate_options["from_"] == {"browser": "chrome", "profile": "Default"}

    # Migrated cookies are appended to any explicit seed_cookies.
    assert connect_options[0].seed_cookies == [
        {"name": "existing", "value": "keep"},
        {"name": "SID", "value": "migrated", "domain": ".google.com"},
    ]

    # The session exposes the report without the bulky raw cookie list.
    assert result.migration is not None
    assert result.migration["migrated"]["bookmarks"] == 2
    assert result.migration["migrated"]["cookies"] == 1
    assert "cookies" not in result.migration


async def test_launch_without_migrate_from_does_not_migrate(tmp_path: Path) -> None:
    async def migrate_profile(**_options: Any) -> Any:
        raise AssertionError("migrate_profile must not run")

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(user_data_dir=str(tmp_path / "profile")),
        resolve_executable=_executable,
        reserve_port=lambda: 9446,
        spawn_browser=lambda *_args, **_options: FakeProcess([]),
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:9446",
        connect=_connected(),
        migrate_profile=migrate_profile,
    )
    assert result.migration is None


async def test_removes_the_temporary_profile_when_migration_fails() -> None:
    targets: list[str] = []
    spawned: list[Any] = []

    async def migrate_profile(**options: Any) -> Any:
        targets.append(options["to"])
        raise RuntimeError("source profile is locked")

    with pytest.raises(RuntimeError, match="source profile is locked"):
        await launch_real_browser_with_dependencies(
            RealBrowserOptions(migrate_from={"browser": "firefox"}),
            resolve_executable=_executable,
            reserve_port=lambda: 9447,
            spawn_browser=lambda *args, **_options: spawned.append(args),
            wait_for_endpoint=lambda **_options: "http://127.0.0.1:9447",
            connect=_connected(),
            migrate_profile=migrate_profile,
        )

    assert spawned == []
    assert len(targets) == 1
    temporary_profile = Path(targets[0]).parent
    assert temporary_profile.name.startswith(TEMPORARY_PROFILE_PREFIX)
    assert not temporary_profile.exists()


async def test_retries_with_a_new_reserved_port_after_a_port_race() -> None:
    calls: list[Any] = []
    ports = [40001, 40002]

    async def wait_for_endpoint(**options: Any) -> str:
        port = options["remote_debugging_port"]
        calls.append(("wait", port))
        if port == 40001:
            raise PortRaceError(40001, "taken")
        return f"http://127.0.0.1:{port}"

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(close_timeout=50),
        resolve_executable=_executable,
        reserve_port=lambda: ports.pop(0),
        spawn_browser=lambda *_args, **_options: FakeProcess(calls),
        wait_for_endpoint=wait_for_endpoint,
        connect=_connected(),
    )

    assert calls == [("wait", 40001), ("kill",), ("wait", 40002)]
    assert result.remote_debugging_port == 40002
    assert result.close is not None
    await result.close()


async def test_does_not_retry_a_port_the_caller_chose() -> None:
    attempts = 0

    async def wait_for_endpoint(**_options: Any) -> str:
        nonlocal attempts
        attempts += 1
        raise PortRaceError(9555, "taken")

    with pytest.raises(PortRaceError):
        await launch_real_browser_with_dependencies(
            RealBrowserOptions(remote_debugging_port=9555, close_timeout=50),
            resolve_executable=_executable,
            spawn_browser=lambda *_args, **_options: FakeProcess([]),
            wait_for_endpoint=wait_for_endpoint,
            connect=_connected(),
        )
    assert attempts == 1


async def test_rejects_port_zero_before_spawning() -> None:
    def spawn_browser(*_args: Any, **_options: Any) -> Any:
        raise AssertionError("must not spawn")

    with pytest.raises(ValueError, match="AutomationControlled"):
        await launch_real_browser_with_dependencies(
            RealBrowserOptions(remote_debugging_port=0),
            resolve_executable=_executable,
            spawn_browser=spawn_browser,
            wait_for_endpoint=lambda **_options: "",
            connect=_connected(),
        )


async def test_uses_a_fresh_temporary_profile_and_deletes_it_on_close() -> None:
    calls: list[Any] = []
    process = FakeProcess(calls)

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(close_timeout=50),
        resolve_executable=_executable,
        reserve_port=lambda: 40003,
        spawn_browser=lambda *_args, **_options: process,
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:40003",
        connect=_connected(),
    )

    assert result.temporary_profile is True
    assert result.user_data_dir is not None
    assert Path(result.user_data_dir).name.startswith(TEMPORARY_PROFILE_PREFIX)
    assert (Path(result.user_data_dir) / "First Run").is_file()
    assert result.close is not None

    await result.close()
    assert calls == [("kill",)]
    assert not Path(result.user_data_dir).exists()
    # close() is idempotent.
    await result.close()
    assert calls == [("kill",)]


async def test_closes_the_browser_gracefully_through_the_engine() -> None:
    calls: list[Any] = []
    process = FakeProcess(calls)

    class Session:
        async def send(self, method: str) -> None:
            calls.append(("send", method))
            process.exit(0)

    class Browser:
        async def new_browser_cdp_session(self) -> Session:
            return Session()

        async def close(self) -> None:
            calls.append(("disconnect",))

    browser = Browser()
    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(engine="playwright"),
        resolve_executable=_executable,
        reserve_port=lambda: 40004,
        spawn_browser=lambda *_args, **_options: process,
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:40004",
        connect=_connected(browser),
    )

    # browser.close() is the session's close(), so it cleans up too.
    await browser.close()
    assert calls == [("send", "Browser.close"), ("disconnect",)]
    assert result.user_data_dir is not None
    assert not Path(result.user_data_dir).exists()


async def test_kills_the_browser_when_it_ignores_the_close_request() -> None:
    calls: list[Any] = []
    process = FakeProcess(calls)

    class Session:
        async def send(self, method: str) -> None:
            calls.append(("send", method))

    class Browser:
        async def new_browser_cdp_session(self) -> Session:
            return Session()

        async def close(self) -> None:
            calls.append(("disconnect",))

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(close_timeout=50),
        resolve_executable=_executable,
        reserve_port=lambda: 40006,
        spawn_browser=lambda *_args, **_options: process,
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:40006",
        connect=_connected(Browser()),
    )
    assert result.close is not None
    await result.close()
    assert calls == [("send", "Browser.close"), ("disconnect",), ("kill",)]


async def test_removes_the_temporary_profile_when_the_browser_exits() -> None:
    process = FakeProcess([])
    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(close_timeout=50),
        resolve_executable=_executable,
        reserve_port=lambda: 40007,
        spawn_browser=lambda *_args, **_options: process,
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:40007",
        connect=_connected(),
    )
    assert result.user_data_dir is not None
    process.exit(0)  # The user closed the window.
    for _ in range(50):
        if not Path(result.user_data_dir).exists():
            break
        await asyncio.sleep(0.02)
    assert not Path(result.user_data_dir).exists()


async def test_passes_restriction_environment_to_the_browser_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    spawn_options: dict[str, Any] = {}

    def spawn_browser(_executable: str, _arguments: list[str], **options: Any) -> Any:
        spawn_options.update(options)
        return FakeProcess([])

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(
            restrictions=["no-google-services"],
            env={"EXTRA": "1"},
            close_timeout=50,
        ),
        resolve_executable=_executable,
        reserve_port=lambda: 40005,
        spawn_browser=spawn_browser,
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:40005",
        connect=_connected(),
    )

    assert spawn_options["env"]["GOOGLE_API_KEY"] == "no"
    assert spawn_options["env"]["GOOGLE_DEFAULT_CLIENT_ID"] == "no"
    assert spawn_options["env"]["EXTRA"] == "1"
    assert "GOOGLE_API_KEY" not in os.environ
    assert result.close is not None
    await result.close()


async def test_terminates_spawned_browser_when_connection_fails(
    tmp_path: Path,
) -> None:
    calls: list[Any] = []

    async def connect(_options: Any) -> Any:
        raise RuntimeError("connection failed")

    with pytest.raises(RuntimeError, match="connection failed"):
        await launch_real_browser_with_dependencies(
            RealBrowserOptions(user_data_dir=str(tmp_path / "profile")),
            resolve_executable=_executable,
            reserve_port=lambda: 9222,
            spawn_browser=lambda *_args, **_options: FakeProcess(calls),
            wait_for_endpoint=lambda **_options: "http://127.0.0.1:9222",
            connect=connect,
        )

    assert calls == [("kill",)]
    # A caller's profile is persistent and is never deleted.
    assert (tmp_path / "profile").is_dir()


def _listening(port: int, browser_id: str = "abc") -> str:
    return (
        f"DevTools listening on ws://127.0.0.1:{port}/devtools/browser/{browser_id}\n"
    )


class _Browser:
    def __init__(self, stderr_text: str = "") -> None:
        self.exit_code = None
        self.stderr = OutputChannel()
        if stderr_text:
            self.stderr.emit(stderr_text)


async def _wait_with(
    stderr_text: str, fetch_version: Any, startup_timeout: int = 2000
) -> str:
    return await wait_for_cdp_endpoint(
        remote_debugging_port=9777,
        user_data_dir="/nonexistent",
        browser_process=_Browser(stderr_text),
        startup_timeout=startup_timeout,
        fetch_version=fetch_version,
    )


async def test_confirms_ownership_from_stderr_and_the_served_browser_id() -> None:
    def fetch_version(endpoint: str, _timeout: float) -> dict[str, str]:
        assert endpoint == "http://127.0.0.1:9777"
        return {"webSocketDebuggerUrl": "ws://127.0.0.1:9777/devtools/browser/abc"}

    assert await _wait_with(_listening(9777), fetch_version) == "http://127.0.0.1:9777"


async def test_reports_a_race_when_another_browser_answers_on_the_port() -> None:
    def fetch_version(_endpoint: str, _timeout: float) -> dict[str, str]:
        return {"webSocketDebuggerUrl": "ws://127.0.0.1:9777/devtools/browser/other"}

    with pytest.raises(PortRaceError):
        await _wait_with(_listening(9777, "ours"), fetch_version)


async def test_reports_a_race_when_chrome_fell_back_to_another_address() -> None:
    def fetch_version(_endpoint: str, _timeout: float) -> None:
        raise AssertionError("must not probe a port we do not own")

    stderr_text = (
        "bind() failed: Address already in use (98)\n"
        "DevTools listening on ws://[::1]:9777/devtools/browser/x\n"
    )
    with pytest.raises(PortRaceError):
        await _wait_with(stderr_text, fetch_version)


async def test_reports_a_race_when_devtools_cannot_bind() -> None:
    def fetch_version(_endpoint: str, _timeout: float) -> None:
        raise AssertionError("must not probe a port we do not own")

    with pytest.raises(PortRaceError):
        await _wait_with("Cannot start http server for devtools.\n", fetch_version)


async def test_never_probes_the_port_before_the_browser_claims_it() -> None:
    probes = 0

    def fetch_version(_endpoint: str, _timeout: float) -> None:
        nonlocal probes
        probes += 1

    with pytest.raises(TimeoutError, match="Timed out"):
        await _wait_with("", fetch_version, startup_timeout=300)
    assert probes == 0


async def test_accepts_dev_tools_active_port_when_stderr_is_unavailable(
    tmp_path: Path,
) -> None:
    (tmp_path / "DevToolsActivePort").write_text("9777\n/devtools/browser/abc\n")

    class Bare:
        exit_code = None

    endpoint = await wait_for_cdp_endpoint(
        remote_debugging_port=9777,
        user_data_dir=tmp_path,
        browser_process=Bare(),
        startup_timeout=2000,
        fetch_version=lambda _endpoint, _timeout: {"webSocketDebuggerUrl": "ws://x"},
    )
    assert endpoint == "http://127.0.0.1:9777"


async def test_reports_a_browser_that_exits_during_startup() -> None:
    browser = _Browser()
    browser.exit_code = 1  # type: ignore[assignment]
    with pytest.raises(RuntimeError, match=r"exited .* \(exit 1\)"):
        await wait_for_cdp_endpoint(
            remote_debugging_port=9777,
            user_data_dir="/nonexistent",
            browser_process=browser,
            startup_timeout=2000,
            fetch_version=lambda _endpoint, _timeout: None,
        )
