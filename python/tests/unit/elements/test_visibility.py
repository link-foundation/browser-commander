"""Unit tests for element visibility utilities."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.elements.visibility import (
    count,
    is_enabled,
    is_visible,
)
from tests.helpers.mocks import create_mock_playwright_page


# ---------------------------------------------------------------------------
# is_visible
# ---------------------------------------------------------------------------
class TestIsVisible:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await is_visible(page=page, engine="playwright", selector="")

    async def test_returns_true_when_element_visible(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.wait_for = AsyncMock()  # succeeds = visible
        page.locator = MagicMock(return_value=mock_locator)

        result = await is_visible(
            page=page,
            engine="playwright",
            selector="button",
        )

        assert result is True

    async def test_returns_false_when_element_not_visible(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.wait_for = AsyncMock(side_effect=Exception("timeout"))
        page.locator = MagicMock(return_value=mock_locator)

        result = await is_visible(
            page=page,
            engine="playwright",
            selector="button",
        )

        assert result is False

    async def test_returns_false_on_navigation_error(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.wait_for = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )
        page.locator = MagicMock(return_value=mock_locator)

        result = await is_visible(
            page=page,
            engine="playwright",
            selector="button",
        )

        assert result is False


# ---------------------------------------------------------------------------
# is_enabled
# ---------------------------------------------------------------------------
class TestIsEnabled:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await is_enabled(page=page, engine="playwright", selector="")

    async def test_returns_true_when_element_enabled(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=False)  # not disabled
        mock_locator.first = MagicMock(return_value=mock_locator)
        page.locator = MagicMock(return_value=mock_locator)

        result = await is_enabled(
            page=page,
            engine="playwright",
            selector="button",
        )

        assert result is True

    async def test_returns_false_when_element_disabled(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(return_value=True)  # disabled
        mock_locator.first = MagicMock(return_value=mock_locator)
        page.locator = MagicMock(return_value=mock_locator)

        result = await is_enabled(
            page=page,
            engine="playwright",
            selector="button",
        )

        assert result is False

    async def test_returns_false_on_navigation_error(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.evaluate = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )
        mock_locator.first = MagicMock(return_value=mock_locator)
        page.locator = MagicMock(return_value=mock_locator)

        result = await is_enabled(
            page=page,
            engine="playwright",
            selector="button",
        )

        assert result is False


# ---------------------------------------------------------------------------
# count
# ---------------------------------------------------------------------------
class TestCount:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await count(page=page, engine="playwright", selector="")

    async def test_returns_element_count_playwright(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.count = AsyncMock(return_value=3)
        page.locator = MagicMock(return_value=mock_locator)

        result = await count(page=page, engine="playwright", selector="button")

        assert result == 3

    async def test_returns_zero_on_navigation_error(self):
        page = create_mock_playwright_page()
        mock_locator = MagicMock()
        mock_locator.count = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )
        page.locator = MagicMock(return_value=mock_locator)

        result = await count(page=page, engine="playwright", selector="button")

        assert result == 0
