"""Keyboard interactions - page-level keyboard input.

This module provides functions for sending keyboard events at the page level,
independent of any specific element. This is useful for:
- Dismissing dialogs (Escape key)
- Submitting forms (Enter key)
- Tab navigation
- Keyboard shortcuts (e.g. Ctrl+A)
"""

from __future__ import annotations

from typing import Any

from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType


async def press_key(
    page: Any,
    key: str,
    engine: EngineType | None = None,
    adapter: Any | None = None,
) -> None:
    """Press a key at the page level.

    Supported key names follow the Playwright/Puppeteer convention, e.g.:
    'Escape', 'Enter', 'Tab', 'ArrowDown', 'Control', 'Shift', etc.

    Args:
        page: Browser page object
        key: Key to press
        engine: Engine type ('playwright' or 'selenium')
        adapter: Pre-created engine adapter (optional, created if not provided)

    Raises:
        ValueError: If key is not provided
    """
    if not key:
        msg = "press_key: key is required"
        raise ValueError(msg)

    resolved_adapter = adapter or create_engine_adapter(page, engine)
    await resolved_adapter.keyboard_press(key)


async def type_text(
    page: Any,
    text: str,
    engine: EngineType | None = None,
    adapter: Any | None = None,
) -> None:
    """Type text at the page level (dispatches key events for each character).

    Unlike element-level fill/type, this sends keyboard events to whatever
    element is currently focused on the page.

    Args:
        page: Browser page object
        text: Text to type
        engine: Engine type ('playwright' or 'selenium')
        adapter: Pre-created engine adapter (optional, created if not provided)

    Raises:
        ValueError: If text is not provided
    """
    if not text:
        msg = "type_text: text is required"
        raise ValueError(msg)

    resolved_adapter = adapter or create_engine_adapter(page, engine)
    await resolved_adapter.keyboard_type(text)


async def key_down(
    page: Any,
    key: str,
    engine: EngineType | None = None,
    adapter: Any | None = None,
) -> None:
    """Hold a key down at the page level.

    Must be paired with key_up() to release the key.

    Args:
        page: Browser page object
        key: Key to hold down
        engine: Engine type ('playwright' or 'selenium')
        adapter: Pre-created engine adapter (optional, created if not provided)

    Raises:
        ValueError: If key is not provided
    """
    if not key:
        msg = "key_down: key is required"
        raise ValueError(msg)

    resolved_adapter = adapter or create_engine_adapter(page, engine)
    await resolved_adapter.keyboard_down(key)


async def key_up(
    page: Any,
    key: str,
    engine: EngineType | None = None,
    adapter: Any | None = None,
) -> None:
    """Release a held key at the page level.

    Args:
        page: Browser page object
        key: Key to release
        engine: Engine type ('playwright' or 'selenium')
        adapter: Pre-created engine adapter (optional, created if not provided)

    Raises:
        ValueError: If key is not provided
    """
    if not key:
        msg = "key_up: key is required"
        raise ValueError(msg)

    resolved_adapter = adapter or create_engine_adapter(page, engine)
    await resolved_adapter.keyboard_up(key)
