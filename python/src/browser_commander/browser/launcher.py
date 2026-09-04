"""Browser launcher for browser-commander."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from browser_commander.core.constants import CHROME_ARGS
from browser_commander.core.engine_detection import EngineType
from browser_commander.fingerprint.apply import apply_fingerprint
from browser_commander.fingerprint.automation_parity import (
    apply_automation_parity_args,
    parity_ignored_default_args,
)

ColorScheme = Literal["light", "dark", "no-preference"]


@dataclass
class LaunchOptions:
    """Browser launch configuration options."""

    engine: EngineType = "playwright"
    user_data_dir: str | None = None
    headless: bool = False
    slow_mo: int | None = None  # Default: 150 for Playwright, 0 for Selenium
    verbose: bool = False
    args: list[str] = field(default_factory=list)
    extra_args: list[str] = field(default_factory=list)
    ignore_default_args: bool | list[str] = field(default_factory=list)
    color_scheme: ColorScheme | None = None
    automation_parity: bool = True
    fingerprint: Mapping[str, Any] | None = None
    """Environment fields to present to pages: user agent, timezone, locale,
    core count, screen and the rest. Applied over CDP after launch; see
    ``browser_commander.fingerprint.profile`` for the field list and ``presets``
    for ready-made profiles."""


@dataclass
class LaunchResult:
    """Result of browser launch."""

    browser: Any
    page: Any


def resolve_chrome_args(
    *,
    args: list[str] | None = None,
    extra_args: list[str] | None = None,
    ignore_default_args: bool | list[str] | None = None,
) -> list[str]:
    """Resolve safe defaults followed by compatibility and extra arguments."""

    if ignore_default_args is True:
        defaults: list[str] = []
    else:
        ignored = set(ignore_default_args or [])
        defaults = [argument for argument in CHROME_ARGS if argument not in ignored]
    return [*defaults, *(args or []), *(extra_args or [])]


def resolve_ignored_default_args(
    engine: EngineType,
    *,
    ignore_default_args: bool | list[str] | None = None,
    headless: bool = False,
    automation_parity: bool = True,
) -> bool | list[str]:
    """Merge the caller's exclusions with the ones parity needs.

    Playwright appends its own switches after the caller's ``args``, so a
    switch the engine adds cannot be countered by passing a different value --
    it has to be excluded at launch. See
    ``browser_commander.fingerprint.automation_parity``.
    """

    if ignore_default_args is True:
        return True
    requested = list(ignore_default_args or [])
    parity = (
        parity_ignored_default_args(engine, headless=headless)
        if automation_parity and engine in ("playwright", "selenium")
        else []
    )
    return list(dict.fromkeys([*parity, *requested]))


def selenium_excluded_switches(ignored: bool | list[str]) -> list[str]:
    """Translate switch names into the form ChromeDriver's excludeSwitches wants.

    ChromeDriver matches on the bare switch name, so ``--enable-automation``
    has to be passed as ``enable-automation``, and a switch carrying a value is
    matched by its name alone.
    """

    if ignored is True or not ignored:
        return []
    names = [argument.lstrip("-").split("=", 1)[0] for argument in ignored]
    return list(dict.fromkeys(name for name in names if name))


async def launch_browser(options: LaunchOptions | None = None) -> LaunchResult:
    """Launch browser with default configuration.

    Args:
        options: Launch configuration options

    Returns:
        LaunchResult with browser and page objects

    Raises:
        ValueError: If engine is invalid
    """
    if options is None:
        options = LaunchOptions()

    engine = options.engine
    user_data_dir = options.user_data_dir
    headless = options.headless
    slow_mo = options.slow_mo
    verbose = options.verbose
    color_scheme = options.color_scheme

    # Set default user data directory
    if user_data_dir is None:
        user_data_dir = str(Path.home() / ".browser-commander" / f"{engine}-data")

    # Set default slow_mo based on engine
    if slow_mo is None:
        slow_mo = 150 if engine == "playwright" else 0

    chrome_args = resolve_chrome_args(
        args=options.args,
        extra_args=options.extra_args,
        ignore_default_args=options.ignore_default_args,
    )
    if options.automation_parity:
        chrome_args = apply_automation_parity_args(chrome_args)
    ignored_default_args = resolve_ignored_default_args(
        engine,
        ignore_default_args=options.ignore_default_args,
        headless=headless,
        automation_parity=options.automation_parity,
    )

    if engine not in ("playwright", "selenium"):
        msg = f"Invalid engine: {engine}. Expected 'playwright' or 'selenium'"
        raise ValueError(msg)

    # Set environment variables to suppress warnings
    os.environ["GOOGLE_API_KEY"] = "no"
    os.environ["GOOGLE_DEFAULT_CLIENT_ID"] = "no"
    os.environ["GOOGLE_DEFAULT_CLIENT_SECRET"] = "no"

    if verbose:
        print(f"Launching browser with {engine} engine...")

    browser: Any
    page: Any

    if engine == "playwright":
        from playwright.async_api import async_playwright

        playwright = await async_playwright().start()
        context_options: dict[str, Any] = {
            "headless": headless,
            "slow_mo": slow_mo,
            "chromium_sandbox": True,
            "viewport": None,
            "args": chrome_args,
            "ignore_default_args": ignored_default_args,
        }
        # Playwright supports color_scheme as a context-level launch option
        if color_scheme is not None:
            context_options["color_scheme"] = color_scheme

        browser = await playwright.chromium.launch_persistent_context(
            user_data_dir,
            **context_options,
        )
        pages = browser.pages
        page = pages[0] if pages else await browser.new_page()

    else:  # selenium
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service

        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless=new")
        for arg in chrome_args:
            chrome_options.add_argument(arg)
        chrome_options.add_argument(f"--user-data-dir={user_data_dir}")
        # ChromeDriver names its own switches without the leading dashes.
        excluded = selenium_excluded_switches(ignored_default_args)
        if excluded:
            chrome_options.add_experimental_option("excludeSwitches", excluded)

        service = Service()
        browser = webdriver.Chrome(service=service, options=chrome_options)
        page = browser  # In Selenium, driver is both browser and page

    if verbose:
        print(f"Browser launched with {engine} engine")

    # Apply color scheme emulation for Selenium via CDP
    if color_scheme is not None and engine == "selenium":
        try:
            from browser_commander.browser.media import emulate_media

            await emulate_media(page=page, engine=engine, color_scheme=color_scheme)
            if verbose:
                print(f'Color scheme set to "{color_scheme}"')
        except Exception as e:
            if verbose:
                print(f"Could not set color scheme: {e}")

    # The fingerprint is applied before the caller can navigate, so the first
    # document a page loads already sees the configured environment.
    if options.fingerprint is not None:
        await apply_fingerprint(
            page=page, browser=browser, engine=engine, profile=options.fingerprint
        )
        if verbose:
            print("Fingerprint profile applied")

    # Unfocus address bar automatically after browser launch
    try:
        await asyncio.sleep(0.5)  # Wait for browser to initialize
        if engine == "playwright":
            await page.bring_to_front()
        if verbose:
            print("Address bar unfocused automatically")
    except Exception as e:
        if verbose:
            print(f"Could not unfocus address bar: {e}")

    return LaunchResult(browser=browser, page=page)
