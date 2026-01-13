"""Browser launcher for browser-commander."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from browser_commander.core.constants import CHROME_ARGS
from browser_commander.core.engine_detection import EngineType


@dataclass
class LaunchOptions:
    """Browser launch configuration options."""

    engine: EngineType = "playwright"
    user_data_dir: str | None = None
    headless: bool = False
    slow_mo: int | None = None  # Default: 150 for Playwright, 0 for Selenium
    verbose: bool = False
    args: list[str] = field(default_factory=list)


@dataclass
class LaunchResult:
    """Result of browser launch."""

    browser: Any
    page: Any


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
    extra_args = options.args

    # Set default user data directory
    if user_data_dir is None:
        user_data_dir = str(Path.home() / ".browser-commander" / f"{engine}-data")

    # Set default slow_mo based on engine
    if slow_mo is None:
        slow_mo = 150 if engine == "playwright" else 0

    # Combine default CHROME_ARGS with custom args
    chrome_args = CHROME_ARGS + extra_args

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
        browser = await playwright.chromium.launch_persistent_context(
            user_data_dir,
            headless=headless,
            slow_mo=slow_mo,
            chromium_sandbox=True,
            viewport=None,
            args=chrome_args,
            ignore_default_args=["--enable-automation"],
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

        service = Service()
        browser = webdriver.Chrome(service=service, options=chrome_options)
        page = browser  # In Selenium, driver is both browser and page

    if verbose:
        print(f"Browser launched with {engine} engine")

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
