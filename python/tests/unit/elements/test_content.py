"""Unit tests for element content utilities."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.elements.content import (
    get_attribute,
    get_input_value,
    input_value,
    log_element_info,
    text_content,
)
from tests.helpers.mocks import create_mock_logger, create_mock_playwright_page


# ---------------------------------------------------------------------------
# text_content
# ---------------------------------------------------------------------------
class TestTextContent:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await text_content(page=page, engine="playwright", selector="")

    async def test_returns_text_content_playwright(self):
        page = create_mock_playwright_page(
            elements={"div": MagicMock(text_content="Hello World", count=1)}
        )
        adapter = MagicMock()
        adapter.get_text_content = AsyncMock(return_value="Hello World")

        result = await text_content(
            page=page,
            engine="playwright",
            selector="div",
            adapter=adapter,
        )

        assert result == "Hello World"

    async def test_returns_none_on_navigation_error(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_text_content = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await text_content(
            page=page,
            engine="playwright",
            selector="div",
            adapter=adapter,
        )

        assert result is None


# ---------------------------------------------------------------------------
# input_value
# ---------------------------------------------------------------------------
class TestInputValue:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector is required"):
            await input_value(page=page, engine="playwright", selector="")

    async def test_returns_input_value_playwright(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_input_value = AsyncMock(return_value="test value")

        result = await input_value(
            page=page,
            engine="playwright",
            selector="input",
            adapter=adapter,
        )

        assert result == "test value"

    async def test_returns_empty_string_on_navigation_error(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_input_value = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await input_value(
            page=page,
            engine="playwright",
            selector="input",
            adapter=adapter,
        )

        assert result == ""


# ---------------------------------------------------------------------------
# get_attribute
# ---------------------------------------------------------------------------
class TestGetAttribute:
    async def test_raises_when_selector_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector and attribute are required"):
            await get_attribute(
                page=page,
                engine="playwright",
                selector="",
                attribute="href",
            )

    async def test_raises_when_attribute_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="selector and attribute are required"):
            await get_attribute(
                page=page,
                engine="playwright",
                selector="a",
                attribute="",
            )

    async def test_returns_attribute_value(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_attribute = AsyncMock(return_value="https://example.com")

        result = await get_attribute(
            page=page,
            engine="playwright",
            selector="a",
            attribute="href",
            adapter=adapter,
        )

        assert result == "https://example.com"

    async def test_returns_none_on_navigation_error(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_attribute = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await get_attribute(
            page=page,
            engine="playwright",
            selector="a",
            attribute="href",
            adapter=adapter,
        )

        assert result is None


# ---------------------------------------------------------------------------
# get_input_value (helper)
# ---------------------------------------------------------------------------
class TestGetInputValue:
    async def test_raises_when_locator_not_provided(self):
        page = create_mock_playwright_page()

        with pytest.raises(ValueError, match="locator_or_element is required"):
            await get_input_value(
                page=page,
                engine="playwright",
                locator_or_element=None,
            )

    async def test_returns_value_from_adapter(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_input_value = AsyncMock(return_value="adapter value")

        result = await get_input_value(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            adapter=adapter,
        )

        assert result == "adapter value"

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        adapter = MagicMock()
        adapter.get_input_value = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        result = await get_input_value(
            page=page,
            engine="playwright",
            locator_or_element=MagicMock(),
            adapter=adapter,
        )

        assert result == ""


# ---------------------------------------------------------------------------
# log_element_info
# ---------------------------------------------------------------------------
class TestLogElementInfo:
    async def test_does_not_throw_when_locator_not_provided(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()

        await log_element_info(
            page=page,
            engine="playwright",
            log=log,
            locator_or_element=None,
        )
        # Should not throw

    async def test_logs_element_information(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        mock_locator = MagicMock()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(return_value="BUTTON")
        adapter.get_text_content = AsyncMock(return_value="Click me")

        await log_element_info(
            page=page,
            engine="playwright",
            log=log,
            locator_or_element=mock_locator,
            adapter=adapter,
        )
        # Should log without error

    async def test_handles_navigation_error(self):
        page = create_mock_playwright_page()
        log = create_mock_logger()
        adapter = MagicMock()
        adapter.evaluate_on_element = AsyncMock(
            side_effect=Exception("Execution context was destroyed")
        )

        await log_element_info(
            page=page,
            engine="playwright",
            log=log,
            locator_or_element=MagicMock(),
            adapter=adapter,
        )
        # Should not throw
