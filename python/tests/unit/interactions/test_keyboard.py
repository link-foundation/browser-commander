"""Unit tests for keyboard interactions."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from browser_commander.core.engine_adapter import PlaywrightAdapter
from browser_commander.interactions.keyboard import (
    key_down,
    key_up,
    press_key,
    type_text,
)
from tests.helpers.mocks import create_mock_playwright_page


# ---------------------------------------------------------------------------
# press_key
# ---------------------------------------------------------------------------
class TestPressKey:
    async def test_press_key_playwright(self):
        page = create_mock_playwright_page()
        page.keyboard.press = AsyncMock()

        await press_key(page=page, key="Escape", engine="playwright")

        page.keyboard.press.assert_awaited_once_with("Escape")

    async def test_press_key_with_adapter(self):
        adapter = MagicMock()
        adapter.keyboard_press = AsyncMock()

        await press_key(page=None, key="Enter", adapter=adapter)

        adapter.keyboard_press.assert_awaited_once_with("Enter")

    async def test_press_key_raises_without_key(self):
        page = create_mock_playwright_page()
        with pytest.raises(ValueError, match="key is required"):
            await press_key(page=page, key="", engine="playwright")

    async def test_press_key_raises_when_key_none(self):
        page = create_mock_playwright_page()
        with pytest.raises(ValueError, match="key is required"):
            await press_key(page=page, key=None, engine="playwright")


# ---------------------------------------------------------------------------
# type_text
# ---------------------------------------------------------------------------
class TestTypeText:
    async def test_type_text_playwright(self):
        page = create_mock_playwright_page()
        page.keyboard.type = AsyncMock()

        await type_text(page=page, text="Hello World", engine="playwright")

        page.keyboard.type.assert_awaited_once_with("Hello World")

    async def test_type_text_with_adapter(self):
        adapter = MagicMock()
        adapter.keyboard_type = AsyncMock()

        await type_text(page=None, text="test input", adapter=adapter)

        adapter.keyboard_type.assert_awaited_once_with("test input")

    async def test_type_text_raises_without_text(self):
        page = create_mock_playwright_page()
        with pytest.raises(ValueError, match="text is required"):
            await type_text(page=page, text="", engine="playwright")

    async def test_type_text_raises_when_text_none(self):
        page = create_mock_playwright_page()
        with pytest.raises(ValueError, match="text is required"):
            await type_text(page=page, text=None, engine="playwright")


# ---------------------------------------------------------------------------
# key_down
# ---------------------------------------------------------------------------
class TestKeyDown:
    async def test_key_down_playwright(self):
        page = create_mock_playwright_page()
        page.keyboard.down = AsyncMock()

        await key_down(page=page, key="Control", engine="playwright")

        page.keyboard.down.assert_awaited_once_with("Control")

    async def test_key_down_with_adapter(self):
        adapter = MagicMock()
        adapter.keyboard_down = AsyncMock()

        await key_down(page=None, key="Shift", adapter=adapter)

        adapter.keyboard_down.assert_awaited_once_with("Shift")

    async def test_key_down_raises_without_key(self):
        page = create_mock_playwright_page()
        with pytest.raises(ValueError, match="key is required"):
            await key_down(page=page, key="", engine="playwright")


# ---------------------------------------------------------------------------
# key_up
# ---------------------------------------------------------------------------
class TestKeyUp:
    async def test_key_up_playwright(self):
        page = create_mock_playwright_page()
        page.keyboard.up = AsyncMock()

        await key_up(page=page, key="Control", engine="playwright")

        page.keyboard.up.assert_awaited_once_with("Control")

    async def test_key_up_with_adapter(self):
        adapter = MagicMock()
        adapter.keyboard_up = AsyncMock()

        await key_up(page=None, key="Shift", adapter=adapter)

        adapter.keyboard_up.assert_awaited_once_with("Shift")

    async def test_key_up_raises_without_key(self):
        page = create_mock_playwright_page()
        with pytest.raises(ValueError, match="key is required"):
            await key_up(page=page, key="", engine="playwright")


# ---------------------------------------------------------------------------
# PlaywrightAdapter keyboard methods
# ---------------------------------------------------------------------------
class TestPlaywrightAdapterKeyboard:
    async def test_keyboard_press(self):
        page = create_mock_playwright_page()
        page.keyboard.press = AsyncMock()
        adapter = PlaywrightAdapter(page)

        await adapter.keyboard_press("Escape")

        page.keyboard.press.assert_awaited_once_with("Escape")

    async def test_keyboard_type(self):
        page = create_mock_playwright_page()
        page.keyboard.type = AsyncMock()
        adapter = PlaywrightAdapter(page)

        await adapter.keyboard_type("hello")

        page.keyboard.type.assert_awaited_once_with("hello")

    async def test_keyboard_down(self):
        page = create_mock_playwright_page()
        page.keyboard.down = AsyncMock()
        adapter = PlaywrightAdapter(page)

        await adapter.keyboard_down("Control")

        page.keyboard.down.assert_awaited_once_with("Control")

    async def test_keyboard_up(self):
        page = create_mock_playwright_page()
        page.keyboard.up = AsyncMock()
        adapter = PlaywrightAdapter(page)

        await adapter.keyboard_up("Control")

        page.keyboard.up.assert_awaited_once_with("Control")
