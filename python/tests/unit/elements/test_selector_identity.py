from unittest.mock import AsyncMock, MagicMock

from browser_commander.core.engine_adapter import PlaywrightAdapter
from browser_commander.elements.locators import create_playwright_locator
from browser_commander.elements.selectors import normalize_selector


async def test_native_text_selector_preserves_scope_without_dom_lookup():
    page = MagicMock()
    page.evaluate = AsyncMock(side_effect=AssertionError("unexpected DOM lookup"))
    selector = '.parent button:has-text("B")'
    assert await normalize_selector(page, "playwright", selector) == selector
    page.evaluate.assert_not_awaited()


def test_css_nth_of_type_keeps_sibling_semantics():
    page = MagicMock()
    selector = "section button:nth-of-type(2)"
    assert create_playwright_locator(page, selector) is page.locator.return_value
    page.locator.assert_called_once_with(selector)


def test_shared_adapter_keeps_css_sibling_semantics():
    page = MagicMock()
    selector = "section button:nth-of-type(2)"
    assert PlaywrightAdapter(page).create_locator(selector) is page.locator.return_value
    page.locator.assert_called_once_with(selector)
