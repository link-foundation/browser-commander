"""Which browser binary an automation launch starts (issue #179).

Without ``channel`` or ``executable_path`` a launch starts Chrome for Testing,
the browser ``playwright install chromium`` downloads. It is an application
of its own (``com.google.chrome.for.testing`` on macOS), so the user's Google
Chrome - its Dock icon, its new tabs, the links other apps open - never goes to
the automation window. The installed Google Chrome is used only on request.
"""

from __future__ import annotations

import inspect
import os
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from browser_commander.browser.restrictions import LAUNCH_RESTRICTION_PRESETS

#: The restrictions every Chrome for Testing launch gets by default.
CHROME_FOR_TESTING_RESTRICTIONS: tuple[str, ...] = tuple(
    LAUNCH_RESTRICTION_PRESETS["chrome-for-testing"]
)

INSTALL_COMMAND = "python -m playwright install chromium"

# Chrome for Testing archives unpack to chrome-<platform>; the macOS app is
# "Google Chrome for Testing.app". Playwright's older own Chromium builds
# (chrome-linux, chrome-win, Chromium.app) are not Chrome for Testing.
_CHROME_FOR_TESTING_DIRECTORIES = frozenset(
    {
        "chrome-linux64",
        "chrome-win64",
        "chrome-win32",
        "chrome-mac-x64",
        "chrome-mac-arm64",
    }
)
_SELENIUM_CACHE_PLATFORMS = frozenset(
    {"linux64", "win64", "win32", "mac-x64", "mac-arm64"}
)


def is_chrome_for_testing(executable_path: Any) -> bool:
    """Whether an executable is a Chrome for Testing build, by install path.

    Playwright, Puppeteer, ``@puppeteer/browsers`` and Selenium Manager all
    keep it under a Chrome for Testing archive directory.
    """

    if not isinstance(executable_path, str):
        return False
    segments = re.split(r"[\\/]+", executable_path.lower())
    if any(
        "chrome for testing" in segment or segment in _CHROME_FOR_TESTING_DIRECTORIES
        for segment in segments
    ):
        return True
    # Selenium Manager: ~/.cache/selenium/chrome/<platform>/<version>/chrome
    if "selenium" not in segments:
        return False
    selenium = len(segments) - 1 - segments[::-1].index("selenium")
    following = segments[selenium + 1 : selenium + 3]
    return (
        len(following) == 2
        and following[0] == "chrome"
        and following[1] in _SELENIUM_CACHE_PLATFORMS
    )


def chrome_for_testing_driver(executable_path: Any) -> str | None:
    """The ChromeDriver of a Chrome for Testing's own release, else ``None``.

    A ``chromedriver`` on ``PATH`` belongs to the installed Google Chrome and
    refuses another release, yet Selenium Manager returns it even for a
    ``--browser-path``, so it is told to skip it. Any other browser is left to
    Selenium's own lookup (``None``).
    """

    if not is_chrome_for_testing(executable_path):
        return None
    from selenium.webdriver.common import selenium_manager

    paths = selenium_manager.SeleniumManager().binary_paths(
        [
            "--browser",
            "chrome",
            "--browser-path",
            str(executable_path),
            "--skip-driver-in-path",
        ]
    )
    return str(paths["driver_path"])


def default_restrictions_for(
    executable_path: Any, requested: Sequence[str] | None = None
) -> list[str]:
    """The restrictions a launch of ``executable_path`` gets by default.

    ``requested`` - the caller's ``default_restrictions`` - wins when given
    (``[]`` opts out); otherwise Chrome for Testing gets the
    ``chrome-for-testing`` preset and any other browser nothing.
    """

    if requested is not None:
        return list(requested)
    if is_chrome_for_testing(executable_path):
        return list(CHROME_FOR_TESTING_RESTRICTIONS)
    return []


async def _resolve(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _is_executable(file: Any) -> bool:
    return bool(file) and Path(str(file)).is_file() and os.access(str(file), os.X_OK)


async def _bundled_executable(engine: str) -> str | None:
    # Selenium has no browser of its own; it starts the one Playwright downloaded.
    if engine not in ("playwright", "selenium"):
        return None
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        return str(playwright.chromium.executable_path)


async def bundled_chrome_for_testing(
    engine: str, bundled_executable: Any = None
) -> str | None:
    """Playwright's downloaded Chrome for Testing, when it is installed."""

    try:
        bundled = await _resolve((bundled_executable or _bundled_executable)(engine))
    except Exception:
        return None
    return str(bundled) if _is_executable(bundled) else None


async def resolve_launch_executable(
    *,
    engine: str,
    channel: str | None = None,
    executable_path: str | None = None,
    resolve_system: Any = None,
    bundled_executable: Any = None,
) -> str:
    """Pick the browser binary for a launch.

    An explicit ``executable_path`` or ``channel`` is honoured as given.
    Without either, Playwright's downloaded Chrome for Testing is started, for
    Selenium too. The installed Google Chrome is never a silent fallback:
    without Chrome for Testing the launch fails and says how to install it or
    how to ask for Google Chrome.

    Raises:
        FileNotFoundError: When Chrome for Testing is not installed.
    """

    if executable_path is not None or channel is not None:
        if resolve_system is None:
            from browser_commander.browser.system_browser import (
                resolve_system_browser_executable as resolve_system,
            )
        return str(
            await _resolve(
                resolve_system(
                    channel=channel or "chrome", executable_path=executable_path
                )
            )
        )
    bundled = await bundled_chrome_for_testing(engine, bundled_executable)
    if bundled:
        return bundled
    msg = (
        f"Chrome for Testing is not installed for {engine}: run "
        f"`{INSTALL_COMMAND}`, or pass channel='chrome' to start the installed "
        "Google Chrome"
    )
    raise FileNotFoundError(msg)
