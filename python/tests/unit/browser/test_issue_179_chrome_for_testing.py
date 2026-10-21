"""Chrome for Testing by default, without its infobar or keychain prompts (#179).

Mirrors js/tests/unit/browser/launch-executable.test.js and the issue #179
cases of real-browser.test.js.
"""

# feature-parity: launch.chrome-for-testing@native-typed

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

import browser_commander
from browser_commander.browser.connector import (
    ConnectOptions,
    connect_browser_with_dependencies,
)
from browser_commander.browser.launch_executable import (
    CHROME_FOR_TESTING_RESTRICTIONS,
    default_restrictions_for,
    is_chrome_for_testing,
)
from browser_commander.browser.launcher import (
    LaunchOptions,
    LaunchResult,
    launch_browser_with_dependencies,
)
from browser_commander.browser.parity import _requested_args_for
from browser_commander.browser.real_browser import (
    RealBrowserOptions,
    launch_real_browser_with_dependencies,
)
from browser_commander.browser.restrictions import resolve_restrictions

PLAYWRIGHT_CFT = "/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"
MAC_CFT = (
    "/Users/u/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)
GOOGLE_CHROME = "/opt/google/chrome/chrome"


@pytest.mark.parametrize(
    "executable",
    [
        # Playwright
        PLAYWRIGHT_CFT,
        MAC_CFT,
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
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/"
        "Google Chrome for Testing",
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
        GOOGLE_CHROME,
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "/usr/bin/chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        # Playwright's own Chromium builds before Chrome for Testing
        "/home/u/.cache/ms-playwright/chromium-1100/chrome-linux/chrome",
        "/Users/u/Library/Caches/ms-playwright/chromium-1100/chrome-mac/"
        "Chromium.app/Contents/MacOS/Chromium",
        # Selenium Manager's Firefox cache
        "/home/u/.cache/selenium/firefox/linux64/133.0/firefox",
    ],
)
def test_leaves_every_other_browser_alone(executable: Any) -> None:
    assert is_chrome_for_testing(executable) is False


def test_gives_chrome_for_testing_the_chrome_for_testing_preset() -> None:
    assert default_restrictions_for(PLAYWRIGHT_CFT) == [
        "no-chrome-for-testing-infobar",
        "mock-keychain",
    ]
    assert default_restrictions_for(GOOGLE_CHROME) == []


def test_uses_the_callers_default_restrictions_as_given() -> None:
    assert default_restrictions_for(PLAYWRIGHT_CFT, []) == []
    assert default_restrictions_for(GOOGLE_CHROME, ["mock-keychain"]) == [
        "mock-keychain"
    ]
    # The preset itself is never handed out to be mutated.
    default_restrictions_for(PLAYWRIGHT_CFT).append("no-sync")
    assert CHROME_FOR_TESTING_RESTRICTIONS == (
        "no-chrome-for-testing-infobar",
        "mock-keychain",
    )


def test_hides_the_infobar_with_test_type_gpu_and_skips_the_keychain_prompt() -> None:
    assert resolve_restrictions(["chrome-for-testing"]).args == [
        "--test-type=gpu",
        "--use-mock-keychain",
    ]
    api = browser_commander
    assert list(api.LAUNCH_RESTRICTION_PRESETS["chrome-for-testing"]) == [
        "no-chrome-for-testing-infobar",
        "mock-keychain",
    ]
    assert api.is_chrome_for_testing is is_chrome_for_testing
    assert api.CHROME_FOR_TESTING_RESTRICTIONS == CHROME_FOR_TESTING_RESTRICTIONS


class FakeProcess:
    exit_code: int | None = None

    def kill(self) -> None:
        self.exit_code = 143

    def once(self, _event: str, listener: Any) -> None:
        if self.exit_code is not None:
            listener(self.exit_code)


async def _launch_real(
    executable: str, platform: str = "linux", **options: Any
) -> tuple[Any, list[str], dict[str, Any]]:
    spawned: dict[str, Any] = {}
    migrated: dict[str, Any] = {}

    def spawn_browser(_executable: str, arguments: list[str], **_options: Any) -> Any:
        spawned["args"] = arguments
        return FakeProcess()

    async def migrate_profile(**migrate_options: Any) -> dict[str, Any]:
        migrated.update(migrate_options)
        return {"migrated": {}, "skipped": [], "warnings": [], "cookies": []}

    async def connect(connect_options: Any) -> LaunchResult:
        spawned["connect"] = connect_options
        return LaunchResult(browser=None, page=None)

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(close_timeout=50, **options),
        resolve_executable=lambda **_options: executable,
        reserve_port=lambda: 40179,
        spawn_browser=spawn_browser,
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:40179",
        connect=connect,
        migrate_profile=migrate_profile,
        platform=platform,
    )
    assert result.close is not None
    await result.close()
    result.connect_options = spawned["connect"]
    return result, spawned["args"], migrated


async def test_a_real_chrome_for_testing_launch_hides_the_infobar_and_keychain() -> (
    None
):
    result, args, _ = await _launch_real(PLAYWRIGHT_CFT)
    assert "--test-type=gpu" in args
    assert "--use-mock-keychain" in args
    assert result.default_restrictions == [
        "no-chrome-for-testing-infobar",
        "mock-keychain",
    ]


async def test_a_real_launch_of_google_chrome_or_an_opt_out_adds_nothing() -> None:
    for executable, options in [
        (GOOGLE_CHROME, {"channel": "chrome"}),
        (PLAYWRIGHT_CFT, {"default_restrictions": []}),
    ]:
        result, args, _ = await _launch_real(executable, **options)
        assert "--test-type=gpu" not in args
        assert "--use-mock-keychain" not in args
        assert result.default_restrictions == []


async def test_selenium_attaches_with_the_driver_of_the_started_browser() -> None:
    # Selenium Manager would otherwise match ChromeDriver to the installed
    # Google Chrome, which refuses to drive Chrome for Testing.
    result, _, _ = await _launch_real(PLAYWRIGHT_CFT, engine="selenium")
    assert result.connect_options.executable_path == PLAYWRIGHT_CFT


async def test_selenium_connect_gives_selenium_manager_the_browser_path() -> None:
    create_selenium = MagicMock(return_value=MagicMock())
    await connect_browser_with_dependencies(
        ConnectOptions(
            engine="selenium",
            cdp_endpoint="http://127.0.0.1:40179",
            executable_path=PLAYWRIGHT_CFT,
        ),
        create_selenium=create_selenium,
    )
    chrome_options = create_selenium.call_args.args[0]
    assert chrome_options.debugger_address == "127.0.0.1:40179"
    assert chrome_options.binary_location == PLAYWRIGHT_CFT


@pytest.mark.parametrize(
    ("executable", "options", "browser", "keystore"),
    [
        # The default launch: Chrome for Testing with its mock keychain.
        (MAC_CFT, {}, "chromium", "mock"),
        # Opting out of the defaults uses the real "Chromium Safe Storage".
        (MAC_CFT, {"default_restrictions": []}, "chromium", "os"),
        (GOOGLE_CHROME, {"channel": "chrome"}, "chrome", "os"),
        (
            GOOGLE_CHROME,
            {"channel": "chrome", "restrictions": ["mock-keychain"]},
            "chrome",
            "mock",
        ),
    ],
)
async def test_migrates_passwords_with_the_key_of_the_browser_that_starts(
    tmp_path: Path,
    executable: str,
    options: dict[str, Any],
    browser: str,
    keystore: str,
) -> None:
    _, _, migrated = await _launch_real(
        executable,
        platform="darwin",
        user_data_dir=str(tmp_path / "profile"),
        migrate_from={"browser": "chrome", "include": ["passwords"]},
        **options,
    )
    assert migrated["target_browser"] == browser
    assert migrated["target_keystore"] == keystore


class FakeContext:
    pages: list[Any] = [object()]  # noqa: RUF012

    async def close(self) -> None:
        return None


class FakePlaywright:
    def __init__(self, calls: list[Any]) -> None:
        self.calls = calls
        self.chromium = self

    async def launch_persistent_context(
        self, _user_data_dir: str, **options: Any
    ) -> FakeContext:
        self.calls.append(options)
        return FakeContext()

    async def stop(self) -> None:
        return None


async def _launch_engine(**options: Any) -> tuple[Any, dict[str, Any]]:
    calls: list[Any] = []

    async def start_playwright() -> FakePlaywright:
        return FakePlaywright(calls)

    result = await launch_browser_with_dependencies(
        LaunchOptions(launch="engine", **options),
        {
            "start_playwright": start_playwright,
            "bundled_executable": lambda _engine: PLAYWRIGHT_CFT,
            "settle_seconds": 0,
        },
    )
    assert result.close is not None
    await result.close()
    return result, calls[0]


async def test_a_playwright_engine_launch_starts_chrome_for_testing_quietly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import browser_commander.browser.launch_executable as launch_executable

    monkeypatch.setattr(launch_executable, "_is_executable", lambda _file: True)
    result, options = await _launch_engine()
    assert options["executable_path"] == PLAYWRIGHT_CFT
    assert "channel" not in options
    assert "--test-type=gpu" in options["args"]
    assert "--use-mock-keychain" in options["args"]
    assert result.default_restrictions == list(CHROME_FOR_TESTING_RESTRICTIONS)


async def test_a_playwright_engine_launch_of_a_channel_is_left_to_playwright() -> None:
    result, options = await _launch_engine(channel="chrome")
    assert options["channel"] == "chrome"
    assert "executable_path" not in options
    assert "--test-type=gpu" not in options["args"]
    assert result.default_restrictions == []


async def test_selenium_starts_chrome_for_testing_never_google_chrome() -> None:
    created: list[Any] = []

    class Driver:
        def quit(self) -> None:
            return None

    def create_selenium(chrome_options: Any, _service_env: Any) -> Driver:
        created.append(chrome_options)
        return Driver()

    downloaded = "/home/u/.cache/selenium/chrome/linux64/131.0.6778.85/chrome"
    result = await launch_browser_with_dependencies(
        LaunchOptions(engine="selenium", launch="engine"),
        {
            "create_selenium": create_selenium,
            "bundled_executable": lambda _engine: None,
            # Selenium Manager downloads Chrome for Testing (--force-browser-download).
            "download_chrome_for_testing": lambda: downloaded,
            "settle_seconds": 0,
        },
    )
    assert result.close is not None
    await result.close()

    assert created[0].binary_location == downloaded
    assert "--test-type=gpu" in created[0].arguments
    assert "--use-mock-keychain" in created[0].arguments
    assert result.default_restrictions == list(CHROME_FOR_TESTING_RESTRICTIONS)


def test_parity_counts_the_default_restrictions_as_requested() -> None:
    session = {
        "args": ["--user-data-dir=/tmp/p", "--test-type=gpu", "--use-mock-keychain"],
        "default_restrictions": list(CHROME_FOR_TESTING_RESTRICTIONS),
    }
    assert _requested_args_for(session, {}) == [
        "--test-type=gpu",
        "--use-mock-keychain",
    ]
    assert _requested_args_for({"args": session["args"]}, {}) == []
