"""Unit tests for element selector utilities."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.elements.selectors import (
    SeleniumTextSelector,
    find_by_text,
    normalize_selector,
    query_selector,
    query_selector_all,
    wait_for_selector,
    with_text_selector_support,
)
from tests.helpers.mocks import create_mock_playwright_page


# ---------------------------------------------------------------------------
# query_selector
# ---------------------------------------------------------------------------
class TestQuerySelector:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await query_selector(page=page, engine="playwright", selector="")

    async def test_finds_element_playwright(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_inner = MagicMock()
        mock_inner.count = AsyncMock(return_value=1)
        mock_locator.first.return_value = mock_inner
        page.locator = MagicMock(return_value=mock_locator)

        el = await query_selector(page=page, engine="playwright", selector="button")
        assert el is not None

    async def test_returns_none_when_element_not_found(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_inner = MagicMock()
        mock_inner.count = AsyncMock(return_value=0)
        mock_locator.first.return_value = mock_inner
        page.locator = MagicMock(return_value=mock_locator)

        el = await query_selector(page=page, engine="playwright", selector="button")
        assert el is None

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_inner = MagicMock()
        mock_inner.count = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )
        mock_locator.first.return_value = mock_inner
        page.locator = MagicMock(return_value=mock_locator)

        el = await query_selector(page=page, engine="playwright", selector="button")
        assert el is None


# ---------------------------------------------------------------------------
# query_selector_all
# ---------------------------------------------------------------------------
class TestQuerySelectorAll:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await query_selector_all(page=page, engine="playwright", selector="")

    async def test_finds_all_elements_playwright(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.count = AsyncMock(return_value=3)
        mock_locator.nth = MagicMock(return_value=mock_locator)
        page.locator = MagicMock(return_value=mock_locator)

        elements = await query_selector_all(
            page=page, engine="playwright", selector="button"
        )
        assert isinstance(elements, list)
        assert len(elements) == 3

    async def test_returns_empty_list_on_navigation_error(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.count = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )
        page.locator = MagicMock(return_value=mock_locator)

        elements = await query_selector_all(
            page=page, engine="playwright", selector="button"
        )
        assert elements == []


# ---------------------------------------------------------------------------
# find_by_text
# ---------------------------------------------------------------------------
class TestFindByText:
    def test_raises_when_text_not_provided(self):
        with pytest.raises(ValueError, match="text is required"):
            find_by_text(engine="playwright", text="")

    def test_returns_playwright_text_selector(self):
        result = find_by_text(engine="playwright", text="Click me")
        assert isinstance(result, str)
        assert "Click me" in result

    def test_returns_playwright_exact_selector(self):
        result = find_by_text(engine="playwright", text="Submit", exact=True)
        assert isinstance(result, str)
        assert "Submit" in result
        assert ":text-is" in result

    def test_returns_selenium_text_selector(self):
        result = find_by_text(engine="selenium", text="Click me", selector="button")
        assert isinstance(result, SeleniumTextSelector)
        assert result.text == "Click me"
        assert result.base_selector == "button"

    def test_selenium_exact_match(self):
        result = find_by_text(
            engine="selenium", text="Exact Text", selector="button", exact=True
        )
        assert isinstance(result, SeleniumTextSelector)
        assert result.exact is True


# ---------------------------------------------------------------------------
# with_text_selector_support
# ---------------------------------------------------------------------------
class TestWithTextSelectorSupport:
    async def test_wraps_function_to_handle_text_selectors(self):
        page = create_mock_playwright_page()
        received_selector = None

        async def dummy_fn(**kwargs):
            nonlocal received_selector
            received_selector = kwargs.get("selector")
            return "result"

        wrapped = with_text_selector_support(
            fn=dummy_fn,
            engine="playwright",
            page=page,
        )
        result = await wrapped(selector="button")
        assert result == "result"
        assert received_selector == "button"


# ---------------------------------------------------------------------------
# normalize_selector
# ---------------------------------------------------------------------------
class TestNormalizeSelector:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await normalize_selector(page=page, engine="playwright", selector="")

    async def test_returns_string_selector_as_is_for_playwright(self):
        page = create_mock_playwright_page()
        result = await normalize_selector(
            page=page, engine="playwright", selector="button.primary"
        )
        # Returns a string selector or processes it
        assert result is not None


# ---------------------------------------------------------------------------
# wait_for_selector
# ---------------------------------------------------------------------------
class TestWaitForSelector:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await wait_for_selector(page=page, engine="playwright", selector="")

    async def test_waits_for_selector_playwright(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.wait_for = AsyncMock()
        page.locator = MagicMock(return_value=mock_locator)

        result = await wait_for_selector(
            page=page,
            engine="playwright",
            selector="button",
            timeout=1000,
        )
        assert result is not None
