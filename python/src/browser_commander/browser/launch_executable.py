"""Which browser binary an automation launch starts (issue #179).

Without ``channel`` or ``executable_path`` a launch starts Chrome for Testing,
the browser Playwright and Selenium Manager download. It is an application of
its own (``com.google.chrome.for.testing`` on macOS), so the user's Google
Chrome - its Dock icon, its new tabs, the links other apps open - never goes
to the automation window. The installed Google Chrome is used only on request.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from browser_commander.browser.chrome_for_testing_cache import (
    cached_chrome_for_testing,
)
from browser_commander.browser.restrictions import LAUNCH_RESTRICTION_PRESETS
from browser_commander.core.engine_detection import EngineType

#: The restrictions every Chrome for Testing launch gets by default.
CHROME_FOR_TESTING_RESTRICTIONS: tuple[str, ...] = LAUNCH_RESTRICTION_PRESETS[
    "chrome-for-testing"
]

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

_INSTALL_COMMANDS = {
    "playwright": "`playwright install chromium`",
    "selenium": (
        "`playwright install chromium` or "
        "`selenium-manager --browser chrome --force-browser-download`"
    ),
}


def is_chrome_for_testing(executable_path: str | None) -> bool:
    """Whether an executable is a Chrome for Testing build, judged by its path.

    Playwright, Puppeteer, ``@puppeteer/browsers`` and Selenium Manager all keep
    it under a Chrome for Testing archive directory.
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


def default_restrictions_for(
    executable_path: str | None, requested: Sequence[str] | None = None
) -> list[str]:
    """The restrictions a launch of ``executable_path`` gets by default.

    The caller's ``default_restrictions`` win when given; otherwise Chrome for
    Testing gets the ``chrome-for-testing`` preset and any other browser none.
    """

    if requested is not None:
        return list(requested)
    return (
        list(CHROME_FOR_TESTING_RESTRICTIONS)
        if is_chrome_for_testing(executable_path)
        else []
    )


async def _resolve(value: Any) -> Any:
    return await value if inspect.isawaitable(value) else value


def _is_executable(file: str | None) -> bool:
    return bool(file) and Path(str(file)).is_file() and os.access(str(file), os.X_OK)


async def _playwright_executable() -> str | None:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return None
    async with async_playwright() as playwright:
        return str(playwright.chromium.executable_path)


def _selenium_manager_executable() -> str | None:
    # Selenium Manager keeps its own Chrome for Testing in ~/.cache/selenium
    # and downloads it when missing; --force-browser-download stops it from
    # picking the installed Google Chrome instead.
    try:
        from selenium.webdriver.common.selenium_manager import SeleniumManager
    except ImportError:
        return None
    paths = SeleniumManager().binary_paths(
        ["--browser", "chrome", "--force-browser-download"]
    )
    return paths.get("browser_path") or None


def _returning(value: str) -> Any:
    async def source() -> str:
        return value

    return source


async def bundled_chrome_for_testing(
    engine: str, *, cached: Any = cached_chrome_for_testing
) -> str | None:
    """The Chrome for Testing an engine downloaded, if any.

    Playwright uses its own, then any other build in its download cache,
    newest first. Selenium has no browser of its own and uses Playwright's,
    then the Playwright, Puppeteer and Selenium Manager caches, then asks
    Selenium Manager, which downloads one when none is there.
    """

    sources: list[Any] = [_playwright_executable]
    try:
        candidates = list(cached(engine))
    except Exception:
        candidates = []
    sources.extend(_returning(candidate) for candidate in candidates)
    if engine == "selenium":
        sources.append(lambda: asyncio.to_thread(_selenium_manager_executable))
    for source in sources:
        try:
            executable = await source()
        except Exception:
            executable = None
        if executable and _is_executable(executable):
            return str(executable)
    return None


async def resolve_launch_executable(
    *,
    engine: EngineType,
    channel: str | None = None,
    executable_path: str | None = None,
    resolve_system: Any = None,
    bundled_executable: Any = None,
) -> str:
    """Pick the browser binary for a launch.

    An explicit ``executable_path`` or ``channel`` is honoured as given.
    Without either, the engine's downloaded Chrome for Testing is started. The
    installed Google Chrome is never a silent fallback: without Chrome for
    Testing the launch fails and says how to install it or how to ask for
    Google Chrome.
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
    try:
        bundled = await _resolve(
            (bundled_executable or bundled_chrome_for_testing)(engine)
        )
    except Exception:
        bundled = None
    if bundled and _is_executable(str(bundled)):
        return str(bundled)
    install = _INSTALL_COMMANDS.get(engine, _INSTALL_COMMANDS["playwright"])
    msg = (
        f"Chrome for Testing is not installed for {engine}: run {install}, "
        "or pass channel='chrome' to start the installed Google Chrome"
    )
    raise FileNotFoundError(msg)
