"""Chrome for Testing is driven and migrated as the browser it is (#179).

Mirrors the issue #179 cases of js/tests/unit/browser/webdriver.test.js,
real-browser.test.js and migration/os-crypt-keys.test.js.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from browser_commander.browser import connector, launcher
from browser_commander.browser.connector import (
    ConnectOptions,
    connect_browser_with_dependencies,
)
from browser_commander.browser.launcher import LaunchResult
from browser_commander.browser.real_browser import (
    RealBrowserOptions,
    launch_real_browser_with_dependencies,
)

PLAYWRIGHT_CFT = "/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"
GOOGLE_CHROME = "/opt/google/chrome/chrome"


class FakeProcess:
    exit_code: int | None = None

    def kill(self) -> None:
        self.exit_code = 143

    def once(self, _event: str, listener: Any) -> None:
        if self.exit_code is not None:
            listener(self.exit_code)


async def _launch_real(
    executable: str, dependencies: dict[str, Any] | None = None, **options: Any
) -> tuple[Any, dict[str, Any]]:
    seen: dict[str, Any] = {}

    async def migrate_profile(**migrate_options: Any) -> dict[str, Any]:
        seen["migrate"] = migrate_options
        return {"migrated": {}, "skipped": [], "warnings": [], "cookies": []}

    async def connect(connect_options: Any) -> LaunchResult:
        seen["connect"] = connect_options
        return LaunchResult(browser=None, page=None)

    result = await launch_real_browser_with_dependencies(
        RealBrowserOptions(close_timeout=50, **options),
        resolve_executable=lambda **_options: executable,
        reserve_port=lambda: 40179,
        spawn_browser=lambda *_args, **_options: FakeProcess(),
        wait_for_endpoint=lambda **_options: "http://127.0.0.1:40179",
        connect=connect,
        migrate_profile=migrate_profile,
        **(dependencies or {}),
    )
    assert result.close is not None
    await result.close()
    return result, seen


async def test_selenium_attaches_with_the_driver_of_the_started_browser() -> None:
    # Selenium Manager would otherwise match ChromeDriver to the installed
    # Google Chrome, which refuses to drive Chrome for Testing.
    _, seen = await _launch_real(PLAYWRIGHT_CFT, engine="selenium")
    assert seen["connect"].executable_path == PLAYWRIGHT_CFT
    _, seen = await _launch_real(PLAYWRIGHT_CFT)
    assert seen["connect"].executable_path is None


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


class _SeleniumManagerStub:
    def __init__(self, calls: list[list[str]]) -> None:
        self._calls = calls

    def binary_paths(self, args: list[str]) -> dict[str, str]:
        self._calls.append(args)
        return {"driver_path": "/cache/chromedriver", "browser_path": args[3]}


@pytest.mark.parametrize("module", [launcher, connector])
@pytest.mark.parametrize(
    ("executable", "driver"),
    [
        # Selenium Manager prefers a chromedriver on PATH even for another
        # release (run 39651456089: ChromeDriver 155 for Chrome 153), so the
        # driver of Chrome for Testing is resolved without it.
        (PLAYWRIGHT_CFT, "/cache/chromedriver"),
        # Any other browser is left to Selenium's own lookup (no driver path).
        (GOOGLE_CHROME, ""),
        (None, ""),
    ],
)
def test_selenium_drives_chrome_for_testing_with_its_own_chromedriver(
    monkeypatch: pytest.MonkeyPatch, module: Any, executable: Any, driver: Any
) -> None:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.common import selenium_manager

    calls: list[list[str]] = []
    monkeypatch.setattr(
        selenium_manager, "SeleniumManager", lambda: _SeleniumManagerStub(calls)
    )
    chrome = MagicMock()
    monkeypatch.setattr(webdriver, "Chrome", chrome)
    chrome_options = Options()
    if executable:
        chrome_options.binary_location = executable
    if module is launcher:
        module._default_create_selenium(chrome_options, None)
    else:
        module._default_create_selenium(chrome_options)
    assert chrome.call_args.kwargs["service"].path == driver
    expected = [
        "--browser",
        "chrome",
        "--browser-path",
        PLAYWRIGHT_CFT,
        "--skip-driver-in-path",
    ]
    assert calls == ([expected] if driver else [])


MAC_CFT = (
    "/Users/u/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)


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
    _, seen = await _launch_real(
        executable,
        {"platform": "darwin"},
        user_data_dir=str(tmp_path / "profile"),
        migrate_from={"browser": "chrome", "include": ["passwords"]},
        **options,
    )
    assert seen["migrate"]["target_browser"] == browser
    assert seen["migrate"]["target_keystore"] == keystore


def test_parity_counts_the_default_restrictions_as_requested() -> None:
    # Chrome for Testing's default switches are requested, not extra (#179).
    from browser_commander.browser.launch_executable import (
        CHROME_FOR_TESTING_RESTRICTIONS,
    )
    from browser_commander.browser.parity import _requested_args_for

    args = ["--user-data-dir=/tmp/p", "--test-type=gpu", "--use-mock-keychain"]
    session = {
        "args": args,
        "default_restrictions": list(CHROME_FOR_TESTING_RESTRICTIONS),
    }
    assert _requested_args_for(session, {}) == [
        "--test-type=gpu",
        "--use-mock-keychain",
    ]
    assert _requested_args_for({"args": args}, {}) == []
