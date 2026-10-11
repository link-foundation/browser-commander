"""Unit tests for attaching to an existing browser over CDP."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander import connect_browser as public_connect_browser
from browser_commander.browser import connect_browser as browser_connect_browser
from browser_commander.browser.connector import (
    ConnectOptions,
    connect_browser,
    connect_browser_with_dependencies,
)


def test_connect_browser_is_exported() -> None:
    assert public_connect_browser is connect_browser
    assert browser_connect_browser is connect_browser


@pytest.mark.asyncio
async def test_connects_playwright_and_seeds_cookies() -> None:
    page = object()
    context = MagicMock()
    context.pages = [page]
    context.add_cookies = AsyncMock()
    browser = MagicMock()
    browser.contexts = [context]
    chromium = MagicMock()
    chromium.connect_over_cdp = AsyncMock(return_value=browser)
    playwright = MagicMock(chromium=chromium)
    cookies = [{"name": "SID", "value": "saved", "domain": ".example.com"}]

    result = await connect_browser_with_dependencies(
        ConnectOptions(
            engine="playwright",
            cdp_endpoint="http://127.0.0.1:9222",
            slow_mo=25,
            timeout=5_000,
            seed_cookies=cookies,
        ),
        start_playwright=AsyncMock(return_value=playwright),
    )

    assert result.browser is browser
    assert result.page is page
    chromium.connect_over_cdp.assert_awaited_once_with(
        "http://127.0.0.1:9222", slow_mo=25, timeout=5_000
    )
    context.add_cookies.assert_awaited_once_with(cookies)


@pytest.mark.asyncio
async def test_connects_playwright_with_portable_storage_state() -> None:
    page = MagicMock()
    page.evaluate = AsyncMock()
    context = MagicMock()
    context.pages = [page]
    context.add_cookies = AsyncMock()
    context.add_init_script = AsyncMock()
    browser = MagicMock(contexts=[context])
    chromium = MagicMock()
    chromium.connect_over_cdp = AsyncMock(return_value=browser)
    state = {
        "cookies": [{"name": "sid", "value": "saved", "domain": "example.test"}],
        "origins": [
            {
                "origin": "https://example.test",
                "localStorage": [{"name": "theme", "value": "dark"}],
            }
        ],
    }

    await connect_browser_with_dependencies(
        ConnectOptions(cdp_endpoint="http://127.0.0.1:9222", storage_state=state),
        start_playwright=AsyncMock(return_value=MagicMock(chromium=chromium)),
    )

    context.add_cookies.assert_awaited_once_with(state["cookies"])
    context.add_init_script.assert_awaited_once()
    page.evaluate.assert_awaited()


@pytest.mark.asyncio
async def test_connects_selenium_and_seeds_cookies_over_cdp() -> None:
    driver = MagicMock()
    create_selenium = MagicMock(return_value=driver)
    cookies = [{"name": "SID", "value": "saved", "domain": ".example.com"}]

    result = await connect_browser_with_dependencies(
        ConnectOptions(
            engine="selenium",
            ws_endpoint="ws://127.0.0.1:9333/devtools/browser/id",
            seed_cookies=cookies,
        ),
        create_selenium=create_selenium,
    )

    assert result.browser is driver
    assert result.page is driver
    chrome_options = create_selenium.call_args.args[0]
    assert chrome_options.debugger_address == "127.0.0.1:9333"
    driver.execute_cdp_cmd.assert_called_once_with("Network.setCookie", cookies[0])


@pytest.mark.asyncio
async def test_requires_exactly_one_endpoint() -> None:
    with pytest.raises(ValueError, match="exactly one of cdp_endpoint or ws_endpoint"):
        await connect_browser_with_dependencies(ConnectOptions())

    with pytest.raises(ValueError, match="exactly one of cdp_endpoint or ws_endpoint"):
        await connect_browser_with_dependencies(
            ConnectOptions(
                cdp_endpoint="http://127.0.0.1:9222",
                ws_endpoint="ws://127.0.0.1:9222/devtools/browser/id",
            )
        )


@pytest.mark.asyncio
async def test_rejects_invalid_engine() -> None:
    with pytest.raises(ValueError, match="Invalid engine: invalid"):
        await connect_browser_with_dependencies(
            ConnectOptions(  # type: ignore[arg-type]
                engine="invalid", cdp_endpoint="http://127.0.0.1:9222"
            )
        )


@pytest.mark.asyncio
async def test_failed_selection_closes_browser_and_stops_driver():
    browser = MagicMock(contexts=[MagicMock(pages=[])])
    browser.close = AsyncMock()
    playwright = MagicMock(stop=AsyncMock())
    playwright.chromium.connect_over_cdp = AsyncMock(return_value=browser)
    with pytest.raises(ValueError, match="No tab matches"):
        await connect_browser_with_dependencies(
            ConnectOptions(cdp_endpoint="http://127.0.0.1:9222", target_id="gone"),
            start_playwright=AsyncMock(return_value=playwright),
        )
    browser.close.assert_awaited_once()
    playwright.stop.assert_awaited_once()


@pytest.mark.asyncio
async def test_no_defaults_recovers_context_management_error():
    page = object()
    browser = MagicMock(
        contexts=[MagicMock(pages=[], new_page=AsyncMock(return_value=page))]
    )
    playwright = MagicMock()
    connect = AsyncMock(
        side_effect=[
            RuntimeError(
                "Protocol error (Browser.setDownloadBehavior): Browser context management is not supported."
            ),
            browser,
        ]
    )
    playwright.chromium.connect_over_cdp = connect
    result = await connect_browser_with_dependencies(
        ConnectOptions(cdp_endpoint="http://127.0.0.1:9222"),
        start_playwright=AsyncMock(return_value=playwright),
    )
    assert result.page is page
    assert connect.await_args.kwargs == {"no_defaults": True}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("selection", "expected"),
    [
        ({"target_id": "second"}, "CDwindow-second"),
        ({"url": ["https://second.test", "https://first.test"]}, "CDwindow-second"),
        (
            {"url_matchers": ["https://second.test", "https://first.test"]},
            "CDwindow-second",
        ),
        ({}, "CDwindow-second"),
        (
            {"target_id": "gone", "fallback": True, "url": ["https://second.test"]},
            "CDwindow-second",
        ),
    ],
)
async def test_selenium_selection_preserves_explicit_ranked_and_current_tabs(
    selection, expected
):
    driver = MagicMock()
    urls = {
        "CDwindow-first": "https://first.test",
        "CDwindow-second": "https://second.test",
    }
    driver.window_handles = list(urls)
    driver.current_window_handle = "CDwindow-second"

    def switch(handle):
        driver.current_window_handle = handle
        driver.current_url = urls[handle]

    driver.switch_to.window.side_effect = switch
    result = await connect_browser_with_dependencies(
        ConnectOptions(
            engine="selenium", cdp_endpoint="http://127.0.0.1:9222", **selection
        ),
        create_selenium=MagicMock(return_value=driver),
    )
    assert result.page is driver
    assert driver.current_window_handle == expected
    driver.quit.assert_not_called()
