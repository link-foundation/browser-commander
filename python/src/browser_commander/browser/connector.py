"""Attach to an already-running Chromium-family browser over CDP."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from browser_commander.browser.launcher import LaunchResult
from browser_commander.core.engine_detection import EngineType


@dataclass
class ConnectOptions:
    """Configuration for a CDP browser connection."""

    engine: EngineType = "playwright"
    cdp_endpoint: str | None = None
    ws_endpoint: str | None = None
    slow_mo: int | None = None
    timeout: int | None = None
    headers: dict[str, str] | None = None
    seed_cookies: list[dict[str, Any]] = field(default_factory=list)
    verbose: bool = False


def _validate_options(options: ConnectOptions) -> str:
    if options.engine not in ("playwright", "selenium"):
        msg = f"Invalid engine: {options.engine}. Expected 'playwright' or 'selenium'"
        raise ValueError(msg)
    if bool(options.cdp_endpoint) == bool(options.ws_endpoint):
        msg = "connect_browser requires exactly one of cdp_endpoint or ws_endpoint"
        raise ValueError(msg)
    return options.cdp_endpoint or options.ws_endpoint or ""


def _debugger_address(endpoint: str) -> str:
    parsed = urlparse(endpoint)
    if parsed.hostname is None or parsed.port is None:
        msg = f"CDP endpoint must include a host and port: {endpoint}"
        raise ValueError(msg)
    host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
    return f"{host}:{parsed.port}"


async def _default_start_playwright() -> Any:
    from playwright.async_api import async_playwright

    return await async_playwright().start()


def _default_create_selenium(chrome_options: Any) -> Any:
    from selenium import webdriver

    return webdriver.Chrome(options=chrome_options)


async def _connect_playwright(
    options: ConnectOptions,
    endpoint: str,
    start_playwright: Any,
) -> LaunchResult:
    playwright = await start_playwright()
    connect_options: dict[str, Any] = {}
    if options.slow_mo is not None:
        connect_options["slow_mo"] = options.slow_mo
    if options.timeout is not None:
        connect_options["timeout"] = options.timeout
    if options.headers is not None:
        connect_options["headers"] = options.headers

    browser = await playwright.chromium.connect_over_cdp(endpoint, **connect_options)
    if not browser.contexts:
        msg = "Connected Playwright browser has no default context"
        raise RuntimeError(msg)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else await context.new_page()
    if options.seed_cookies:
        await context.add_cookies(options.seed_cookies)
    return LaunchResult(browser=browser, page=page)


async def _connect_selenium(
    options: ConnectOptions,
    endpoint: str,
    create_selenium: Any,
) -> LaunchResult:
    from selenium.webdriver.chrome.options import Options

    chrome_options = Options()
    chrome_options.debugger_address = _debugger_address(endpoint)
    browser = create_selenium(chrome_options)
    for cookie in options.seed_cookies:
        browser.execute_cdp_cmd("Network.setCookie", cookie)
    return LaunchResult(browser=browser, page=browser)


async def connect_browser(options: ConnectOptions) -> LaunchResult:
    """Attach to a running browser over an HTTP or WebSocket CDP endpoint."""

    return await connect_browser_with_dependencies(options)


async def connect_browser_with_dependencies(
    options: ConnectOptions,
    *,
    start_playwright: Any | None = None,
    create_selenium: Any | None = None,
) -> LaunchResult:
    """Dependency-injected connector implementation used by tests."""

    endpoint = _validate_options(options)
    if options.verbose:
        print(f"Connecting to browser with {options.engine} engine...")

    if options.engine == "playwright":
        result = await _connect_playwright(
            options,
            endpoint,
            start_playwright or _default_start_playwright,
        )
    else:
        result = await _connect_selenium(
            options,
            endpoint,
            create_selenium or _default_create_selenium,
        )

    if options.verbose:
        print(f"Connected to browser with {options.engine} engine")
    return result
