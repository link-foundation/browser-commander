"""Attach to an already-running Chromium-family browser over CDP."""

from __future__ import annotations

import contextlib
import inspect
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from browser_commander.browser.launcher import LaunchResult
from browser_commander.browser.storage_state import (
    StorageStateInput,
    restore_storage_state,
)
from browser_commander.core.engine_detection import EngineType
from browser_commander.downloads.attach import attach_downloads


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
    storage_state: StorageStateInput = None
    verbose: bool = False
    downloads: bool | Mapping[str, Any] | None = None
    target_id: str | None = None
    url: Any = None
    single_tab: bool = False
    fallback: bool = False
    no_defaults: bool | None = None
    url_matchers: list[Any] = field(default_factory=list)
    """Manage downloads: ``True`` for defaults, or a mapping with ``directory``,
    ``persist`` and ``conflict``."""


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


def matches_url(matcher: Any, url: str) -> bool:
    return bool(
        matcher(url)
        if callable(matcher)
        else matcher.search(url)
        if hasattr(matcher, "search")
        else matcher == url
    )


def _url_matchers(options: ConnectOptions | None) -> list[Any]:
    if options is None:
        return []
    return options.url_matchers or (
        options.url
        if isinstance(options.url, list)
        else [options.url]
        if options.url
        else []
    )


async def pick_foreground_page(
    pages: Sequence[Any], options: ConnectOptions | None = None
) -> Any:
    """Pick the tab that is on screen.

    A browser attached after it started can already have several tabs - a
    fresh Chrome profile opens "What's new" next to the New Tab page - and the
    engine does not list them in a stable order. Driving a background tab would
    make ``document.hidden`` true where a person's first navigation would see a
    visible page, so the visible tab wins and the first tab is the fallback.

    Returns:
        The visible page, else the first page, else ``None`` for no pages.
    """

    targets = {}
    for page in pages:
        session = None
        try:
            session = await page.context.new_cdp_session(page)
            info = await session.send("Target.getTargetInfo")
            targets[id(page)] = info["targetInfo"]["targetId"]
            await session.send("Emulation.setFocusEmulationEnabled", {"enabled": False})
        except Exception:
            pass
        finally:
            if session is not None:
                with contextlib.suppress(Exception):
                    await session.detach()
    selected = None
    matchers = _url_matchers(options)
    if options and (options.target_id or matchers):
        candidates = (
            [page for page in pages if targets.get(id(page)) == options.target_id]
            if options.target_id
            else list(pages)
        )
        eligible = candidates if candidates or not options.fallback else list(pages)
        selected = (
            next(
                (
                    page
                    for matcher in matchers
                    for page in eligible
                    if matches_url(matcher, page.url)
                ),
                None,
            )
            if matchers
            else next(iter(candidates), None)
        )
        if selected is None and not options.fallback:
            raise ValueError("No tab matches the requested target_id/URL")
    for page in [] if selected is not None else pages:
        evaluate = getattr(page, "evaluate", None)
        if not callable(evaluate):
            continue
        try:
            state = evaluate("() => document.visibilityState")
            if inspect.isawaitable(state):
                state = await state
        except Exception:
            state = None
        if state == "visible":
            selected = page
            break
    if selected is None and pages:
        selected = pages[0]
    if options and options.single_tab and selected is not None:
        for page in pages:
            if page is not selected:
                await page.close()
    return selected


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

    if options.no_defaults is not None:
        connect_options["no_defaults"] = options.no_defaults
    browser = None
    try:
        try:
            browser = await playwright.chromium.connect_over_cdp(
                endpoint, **connect_options
            )
        except Exception as error:
            if (
                options.no_defaults is not None
                or "Browser.setDownloadBehavior" not in str(error)
                or "Browser context management is not supported" not in str(error)
            ):
                raise
            browser = await playwright.chromium.connect_over_cdp(
                endpoint, **connect_options, no_defaults=True
            )
        if not browser.contexts:
            msg = "Connected Playwright browser has no default context"
            raise RuntimeError(msg)
        context = browser.contexts[0]
        page = (
            await pick_foreground_page(context.pages, options)
            or await context.new_page()
        )
        await restore_storage_state("playwright", context, page, options.storage_state)
        if options.seed_cookies:
            await context.add_cookies(options.seed_cookies)
    except BaseException:
        if browser is not None:
            with contextlib.suppress(Exception):
                await browser.close()
        await _stop_playwright(playwright)
        raise
    _stop_playwright_on_close(browser, playwright)
    return LaunchResult(browser=browser, page=page)


async def _stop_playwright(playwright: Any) -> None:
    stop = getattr(playwright, "stop", None)
    if callable(stop):
        with contextlib.suppress(Exception):
            result = stop()
            if inspect.isawaitable(result):
                await result


def _stop_playwright_on_close(browser: Any, playwright: Any) -> None:
    """Make ``browser.close()`` also stop the Playwright driver it started.

    Each connection starts its own driver process; without this it would
    outlive the connection.
    """

    original_close = getattr(browser, "close", None)
    if not callable(original_close):
        return

    async def close(*args: Any, **kwargs: Any) -> None:
        try:
            result = original_close(*args, **kwargs)
            if inspect.isawaitable(result):
                await result
        finally:
            await _stop_playwright(playwright)

    with contextlib.suppress(AttributeError, TypeError):
        browser.close = close


async def _connect_selenium(
    options: ConnectOptions,
    endpoint: str,
    create_selenium: Any,
) -> LaunchResult:
    from selenium.webdriver.chrome.options import Options

    chrome_options = Options()
    chrome_options.debugger_address = _debugger_address(endpoint)
    browser = create_selenium(chrome_options)
    try:
        handles = list(browser.window_handles)
        original = browser.current_window_handle if handles else None
        tabs = []
        for handle in handles:
            browser.switch_to.window(handle)
            tabs.append((handle, browser.current_url))
        candidates = [
            tab
            for tab in tabs
            if not options.target_id
            or tab[0] in (options.target_id, "CDwindow-" + options.target_id)
        ]
        requested = candidates[0][0] if options.target_id and candidates else None
        if not candidates and options.fallback:
            candidates = tabs
        matchers = _url_matchers(options)
        selected = (
            next(
                (
                    handle
                    for matcher in matchers
                    for handle, url in candidates
                    if matches_url(matcher, url)
                ),
                None,
            )
            if matchers
            else requested
            if options.target_id
            else original
        )
        if (
            selected is None
            and (options.target_id or matchers)
            and not options.fallback
        ):
            raise ValueError("No tab matches the requested target_id or URL")
        if selected is None:
            selected = original if original in handles else next(iter(handles), None)
        if selected is None:
            browser.switch_to.new_window("tab")
            selected = browser.current_window_handle
        if options.single_tab:
            for handle in handles:
                if handle != selected:
                    browser.switch_to.window(handle)
                    browser.close()
        browser.switch_to.window(selected)
        await restore_storage_state("selenium", browser, browser, options.storage_state)
        for cookie in options.seed_cookies:
            browser.execute_cdp_cmd("Network.setCookie", cookie)
    except BaseException:
        with contextlib.suppress(Exception):
            browser.quit()
        raise
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

    # An attached browser gets the same managed lifecycle as a launched one:
    # the manager is built from the browser and page, not from how we got them.
    try:
        result.downloads = await attach_downloads(
            engine=options.engine,
            browser=result.browser,
            page=result.page,
            downloads=options.downloads,
        )
    except BaseException:
        with contextlib.suppress(Exception):
            if options.engine == "playwright":
                await result.browser.close()
            else:
                result.browser.quit()
        raise
    return result
