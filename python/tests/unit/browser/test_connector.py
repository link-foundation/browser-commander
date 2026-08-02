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
