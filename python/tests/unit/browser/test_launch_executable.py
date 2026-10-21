# feature-parity: launch.chrome-for-testing@native-typed
"""Chrome for Testing by default, without its infobar or keychain prompt (#179)."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

import browser_commander
from browser_commander.browser.launch_executable import (
    CHROME_FOR_TESTING_RESTRICTIONS,
    default_restrictions_for,
    is_chrome_for_testing,
    resolve_launch_executable,
)
from browser_commander.browser.launcher import (
    LaunchOptions,
    LaunchResult,
    launch_browser_with_dependencies,
)
from browser_commander.browser.real_browser import (
    RealBrowserOptions,
    launch_real_browser_with_dependencies,
)
from browser_commander.browser.restrictions import resolve_restrictions

CFT = "/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"


@pytest.mark.parametrize(
    "executable",
    [
        # Playwright
        CFT,
        "/Users/u/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/"
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "C:\\Users\\u\\AppData\\Local\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe",
        # Puppeteer and @puppeteer/browsers
        "/home/u/.cache/puppeteer/chrome/linux-131.0.6778.85/chrome-linux64/chrome",
        "C:\\Users\\u\\.cache\\puppeteer\\chrome\\win32-131.0.6778.85\\chrome-win32\\chrome.exe",
        "/Users/u/Library/Caches/ms-playwright/chromium-1248/chrome-mac-x64/"
        "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        # Selenium Manager
        "/home/u/.cache/selenium/chrome/linux64/131.0.6778.85/chrome",
        "C:\\Users\\u\\.cache\\selenium\\chrome\\win64\\131.0.6778.85\\chrome.exe",
        # An app copied anywhere keeps its name
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ],
)
def test_recognises_the_chrome_for_testing_install_layouts(executable: str) -> None:
    assert is_chrome_for_testing(executable) is True


@pytest.mark.parametrize(
    "executable",
    [
        None,
        "",
        "/usr/bin/google-chrome",
        "/opt/google/chrome/chrome",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "/usr/bin/chromium",
        # Playwright's own Chromium builds before Chrome for Testing
        "/home/u/.cache/ms-playwright/chromium-1100/chrome-linux/chrome",
        "/Users/u/Library/Caches/ms-playwright/chromium-1100/chrome-mac/"
        "Chromium.app/Contents/MacOS/Chromium",
        # Selenium Manager's Firefox cache
        "/home/u/.cache/selenium/firefox/linux64/133.0/firefox",
    ],
)
def test_leaves_every_other_browser_alone(executable: str | None) -> None:
    assert is_chrome_for_testing(executable) is False


def test_chrome_for_testing_gets_the_chrome_for_testing_preset() -> None:
    assert default_restrictions_for(CFT) == [
        "no-chrome-for-testing-infobar",
        "mock-keychain",
    ]
    assert default_restrictions_for("/usr/bin/google-chrome") == []
    # The caller's default_restrictions are used as given.
    assert default_restrictions_for(CFT, []) == []
    assert default_restrictions_for("/usr/bin/google-chrome", ["mock-keychain"]) == [
        "mock-keychain"
    ]
    assert CHROME_FOR_TESTING_RESTRICTIONS == (
        "no-chrome-for-testing-infobar",
        "mock-keychain",
    )
    # --test-type=gpu is the only value Chromium skips the infobar for.
    assert resolve_restrictions(["chrome-for-testing"]).args == [
        "--test-type=gpu",
        "--use-mock-keychain",
    ]


def test_public_api_exports_the_chrome_for_testing_helpers() -> None:
    api = browser_commander
    assert api.is_chrome_for_testing is is_chrome_for_testing
    assert api.default_restrictions_for is default_restrictions_for
    assert api.CHROME_FOR_TESTING_RESTRICTIONS == CHROME_FOR_TESTING_RESTRICTIONS
    for name in [
        "is_chrome_for_testing",
        "default_restrictions_for",
        "CHROME_FOR_TESTING_RESTRICTIONS",
    ]:
        assert name in api.__all__, name


def _executable(tmp_path: Path, relative: str) -> str:
    path = tmp_path / relative
    path.parent.mkdir(parents=True)
    path.write_text("#!/bin/sh\n")
    path.chmod(0o755)
    return str(path)


def _google_chrome(**_request: Any) -> str:
    return "/usr/bin/google-chrome"


async def test_starts_chrome_for_testing_even_with_google_chrome_installed(
    tmp_path: Path,
) -> None:
    cft = _executable(tmp_path, "chromium-1248/chrome-linux64/chrome")
    engines: list[str] = []

    def bundled(engine: str) -> str:
        engines.append(engine)
        return cft

    for engine in ("playwright", "selenium"):
        assert (
            await resolve_launch_executable(
                engine=engine,  # type: ignore[arg-type]
                resolve_system=_google_chrome,
                bundled_executable=bundled,
            )
            == cft
        )
    assert engines == ["playwright", "selenium"]


async def test_never_falls_back_to_the_installed_google_chrome() -> None:
    with pytest.raises(FileNotFoundError) as raised:
        await resolve_launch_executable(
            engine="playwright",
            resolve_system=_google_chrome,
            bundled_executable=lambda _engine: None,
        )
    message = str(raised.value)
    assert "Chrome for Testing is not installed for playwright" in message
    assert "playwright install chromium" in message
    assert "channel='chrome'" in message

    # A path that is not there is not Chrome for Testing either.
    with pytest.raises(FileNotFoundError, match="selenium"):
        await resolve_launch_executable(
            engine="selenium",
            resolve_system=_google_chrome,
            bundled_executable=lambda _engine: "/nonexistent/chrome-linux64/chrome",
        )


async def test_an_explicit_channel_still_starts_the_installed_browser() -> None:
    assert (
        await resolve_launch_executable(
            engine="playwright",
            channel="chrome",
            resolve_system=_google_chrome,
            bundled_executable=lambda _engine: sys.executable,
        )
        == "/usr/bin/google-chrome"
    )


def _recording_real_launcher(calls: list[Any]) -> Any:
    from browser_commander.browser.real_browser import RealBrowserResult

    async def launch(options: RealBrowserOptions) -> RealBrowserResult:
        calls.append(options)

        class Browser:
            contexts: list[Any] = [object()]  # noqa: RUF012

        return RealBrowserResult(
            browser=Browser(),
            page=None,
            executable_path=options.executable_path,
            default_restrictions=["from-the-real-launch"],
        )

    return launch


async def test_launch_browser_starts_chrome_for_testing_by_default(
    tmp_path: Path,
) -> None:
    cft = _executable(tmp_path, "chromium-1248/chrome-linux64/chrome")
    calls: list[Any] = []

    result = await launch_browser_with_dependencies(
        LaunchOptions(),
        {
            "launch_real_browser": _recording_real_launcher(calls),
            "resolve_system": _google_chrome,
            "bundled_executable": lambda _engine: cft,
            "settle_seconds": 0,
        },
    )

    assert calls[0].executable_path == cft
    assert calls[0].channel is None
    assert calls[0].default_restrictions is None
    assert result.executable_path == cft
    assert result.default_restrictions == ["from-the-real-launch"]

    await launch_browser_with_dependencies(
        LaunchOptions(default_restrictions=[]),
        {
            "launch_real_browser": _recording_real_launcher(calls),
            "bundled_executable": lambda _engine: cft,
            "settle_seconds": 0,
        },
    )
    assert calls[1].default_restrictions == []


async def test_rejects_an_unknown_default_restriction_before_launching() -> None:
    with pytest.raises(ValueError, match='Unknown launch restriction "no-such"'):
        await launch_browser_with_dependencies(
            LaunchOptions(default_restrictions=["no-such"]),
            {"launch_real_browser": _recording_real_launcher([])},
        )


class _ExitedProcess:
    """A spawned browser stand-in that has already exited, so close() is quick."""

    exit_code = 0

    def kill(self) -> None:
        pass

    def once(self, _event: str, listener: Any) -> None:
        listener(self.exit_code)


async def _connect(_options: Any) -> LaunchResult:
    return LaunchResult(browser=None, page=None)


async def _real_launch(
    options: RealBrowserOptions, executable: str, monkeypatch: pytest.MonkeyPatch
) -> tuple[Any, dict[str, Any], list[Any]]:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    spawned: dict[str, Any] = {}
    requests: list[Any] = []

    def resolve_executable(**request: Any) -> str:
        requests.append(request)
        return executable

    def spawn(path: str, args: list[str], *, env: Any, verbose: bool) -> Any:
        spawned.update(path=path, args=args, env=env)
        return _ExitedProcess()

    result = await launch_real_browser_with_dependencies(
        options,
        resolve_executable=resolve_executable,
        spawn_browser=spawn,
        wait_for_endpoint=lambda **_kwargs: "http://127.0.0.1:9222",
        connect=_connect,
        reserve_port=lambda: 9222,
    )
    return result, spawned, requests


async def test_real_launch_of_chrome_for_testing_hides_its_infobar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, spawned, requests = await _real_launch(
        RealBrowserOptions(), CFT, monkeypatch
    )
    try:
        assert requests == [{"channel": None, "executable_path": None}]
        assert spawned["path"] == CFT
        assert "--test-type=gpu" in spawned["args"]
        assert "--use-mock-keychain" in spawned["args"]
        assert result.default_restrictions == [
            "no-chrome-for-testing-infobar",
            "mock-keychain",
        ]
        assert result.args == spawned["args"]
    finally:
        assert result.close is not None
        await result.close()


async def test_real_launch_of_google_chrome_adds_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, spawned, _ = await _real_launch(
        RealBrowserOptions(channel="chrome"), "/usr/bin/google-chrome", monkeypatch
    )
    try:
        assert not any(arg.startswith("--test-type") for arg in spawned["args"])
        assert "--use-mock-keychain" not in spawned["args"]
        assert result.default_restrictions == []
    finally:
        assert result.close is not None
        await result.close()


async def test_default_restrictions_can_be_turned_off_or_replaced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result, spawned, _ = await _real_launch(
        RealBrowserOptions(default_restrictions=["mock-keychain"]), CFT, monkeypatch
    )
    try:
        assert "--use-mock-keychain" in spawned["args"]
        assert not any(arg.startswith("--test-type") for arg in spawned["args"])
        assert result.default_restrictions == ["mock-keychain"]
    finally:
        assert result.close is not None
        await result.close()


class _FakeChromium:
    def __init__(self, calls: list[Any], executable_path: str) -> None:
        self.calls = calls
        self.executable_path = executable_path

    async def launch_persistent_context(
        self, user_data_dir: str, **options: Any
    ) -> Any:
        self.calls.append(options)

        class Context:
            pages: list[Any] = [object()]  # noqa: RUF012

            async def close(self) -> None:
                pass

        return Context()


class _FakePlaywright:
    def __init__(self, calls: list[Any], executable_path: str) -> None:
        self.chromium = _FakeChromium(calls, executable_path)

    async def stop(self) -> None:
        pass


async def test_engine_launch_of_chrome_for_testing_hides_its_infobar() -> None:
    calls: list[Any] = []

    async def start_playwright() -> _FakePlaywright:
        return _FakePlaywright(calls, CFT)

    result = await launch_browser_with_dependencies(
        LaunchOptions(launch="engine"),
        {"start_playwright": start_playwright, "settle_seconds": 0},
    )
    try:
        assert "--test-type=gpu" in calls[0]["args"]
        assert "--use-mock-keychain" in calls[0]["args"]
        assert result.default_restrictions == [
            "no-chrome-for-testing-infobar",
            "mock-keychain",
        ]
    finally:
        assert result.close is not None
        await result.close()


async def test_engine_launch_of_an_installed_channel_adds_nothing() -> None:
    calls: list[Any] = []

    async def start_playwright() -> _FakePlaywright:
        return _FakePlaywright(calls, CFT)

    result = await launch_browser_with_dependencies(
        LaunchOptions(launch="engine", channel="chrome"),
        {"start_playwright": start_playwright, "settle_seconds": 0},
    )
    try:
        assert calls[0]["channel"] == "chrome"
        assert not any(arg.startswith("--test-type") for arg in calls[0]["args"])
        assert result.default_restrictions == []
    finally:
        assert result.close is not None
        await result.close()


async def test_selenium_engine_launch_points_chromedriver_at_chrome_for_testing(
    tmp_path: Path,
) -> None:
    cft = _executable(tmp_path, "selenium/chrome/linux64/156.0.8078.47/chrome")
    created: list[Any] = []

    class Driver:
        def quit(self) -> None:
            pass

    def create_selenium(chrome_options: Any, _service_env: Any) -> Driver:
        created.append(chrome_options)
        return Driver()

    result = await launch_browser_with_dependencies(
        LaunchOptions(engine="selenium", launch="engine"),
        {
            "create_selenium": create_selenium,
            "resolve_system": _google_chrome,
            "bundled_executable": lambda _engine: cft,
            "settle_seconds": 0,
        },
    )
    try:
        chrome_options = created[0]
        assert chrome_options.binary_location == cft
        assert "--test-type=gpu" in chrome_options.arguments
        assert "--use-mock-keychain" in chrome_options.arguments
        assert result.default_restrictions == [
            "no-chrome-for-testing-infobar",
            "mock-keychain",
        ]
    finally:
        assert result.close is not None
        await result.close()
