"""Content utilities for browser-commander.

This module provides functions for getting element content and attributes
across both Playwright and Selenium engines.
"""

from __future__ import annotations

from typing import Any

from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.elements.locators import get_locator_or_element


async def text_content(
    page: Any,
    engine: EngineType,
    selector: str | Any,
    adapter: Any | None = None,
) -> str | None:
    """Get text content.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or element
        adapter: Engine adapter (optional, will be created if not provided)

    Returns:
        Text content or None
    """
    if not selector:
        raise ValueError("selector is required")

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        locator_or_element = await get_locator_or_element(page, engine, selector)
        if not locator_or_element:
            return None

        return await adapter.get_text_content(locator_or_element)
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during text_content, returning None")
            return None
        raise


async def input_value(
    page: Any,
    engine: EngineType,
    selector: str | Any,
    adapter: Any | None = None,
) -> str:
    """Get input value.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or element
        adapter: Engine adapter (optional, will be created if not provided)

    Returns:
        Input value
    """
    if not selector:
        raise ValueError("selector is required")

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        locator_or_element = await get_locator_or_element(page, engine, selector)
        if not locator_or_element:
            return ""

        return await adapter.get_input_value(locator_or_element)
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during input_value, returning empty string")
            return ""
        raise


async def get_attribute(
    page: Any,
    engine: EngineType,
    selector: str | Any,
    attribute: str,
    adapter: Any | None = None,
) -> str | None:
    """Get element attribute.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or element
        attribute: Attribute name
        adapter: Engine adapter (optional, will be created if not provided)

    Returns:
        Attribute value or None
    """
    if not selector or not attribute:
        raise ValueError("selector and attribute are required")

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        locator_or_element = await get_locator_or_element(page, engine, selector)
        if not locator_or_element:
            return None

        return await adapter.get_attribute(locator_or_element, attribute)
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during get_attribute, returning None")
            return None
        raise


async def get_input_value(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    adapter: Any | None = None,
) -> str:
    """Get input value from element (helper).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Element or locator
        adapter: Engine adapter (optional, will be created if not provided)

    Returns:
        Input value
    """
    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        return await adapter.get_input_value(locator_or_element)
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during get_input_value, returning empty string")
            return ""
        raise


async def log_element_info(
    page: Any,
    engine: EngineType,
    log: Logger,
    locator_or_element: Any,
    adapter: Any | None = None,
) -> None:
    """Log element information for verbose debugging.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        log: Logger instance
        locator_or_element: Element or locator to log
        adapter: Engine adapter (optional, will be created if not provided)
    """
    if not locator_or_element:
        return

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        tag_name = await adapter.evaluate_on_element(
            locator_or_element,
            "(el) => el.tagName",
        )
        text = await adapter.get_text_content(locator_or_element)
        truncated_text = (text or "").strip()[:30]
        log.debug(lambda: f'Target element: {tag_name}: "{truncated_text}..."')
    except Exception as error:
        if is_navigation_error(error):
            log.debug(lambda: "Navigation detected during log_element_info, skipping")
            return
        raise
