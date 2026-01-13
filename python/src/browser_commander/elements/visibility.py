"""Visibility utilities for browser-commander.

This module provides functions for checking element visibility and state
across both Playwright and Selenium engines.
"""

from __future__ import annotations

from typing import Any

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.elements.locators import get_locator_or_element


async def is_visible(
    page: Any,
    engine: EngineType,
    selector: str | Any,
) -> bool:
    """Check if element is visible.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or element

    Returns:
        True if visible
    """
    if not selector:
        raise ValueError("selector is required")

    try:
        if engine == "playwright":
            locator = await get_locator_or_element(page, engine, selector)
            try:
                visibility_timeout = TIMING.get("VISIBILITY_CHECK_TIMEOUT", 1000)
                await locator.wait_for(state="visible", timeout=visibility_timeout)
                return True
            except Exception:
                return False
        else:
            element = await get_locator_or_element(page, engine, selector)
            if not element:
                return False
            return element.is_displayed()
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during visibility check, returning False")
            return False
        raise


async def is_enabled(
    page: Any,
    engine: EngineType,
    selector: str | Any,
    disabled_classes: list[str] | None = None,
) -> bool:
    """Check if element is enabled (not disabled, not loading).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or locator
        disabled_classes: Additional CSS classes that indicate disabled state

    Returns:
        True if enabled
    """
    if disabled_classes is None:
        disabled_classes = ["magritte-button_loading"]

    if not selector:
        raise ValueError("selector is required")

    try:
        if engine == "playwright":
            # For Playwright, use locator API
            locator = (
                page.locator(selector).first()
                if isinstance(selector, str)
                else selector
            )

            # Check disabled state via JavaScript
            is_disabled = await locator.evaluate(
                """(el, classes) => {
                    const isDisabled = el.hasAttribute('disabled') ||
                        el.getAttribute('aria-disabled') === 'true' ||
                        classes.some(cls => el.classList.contains(cls));
                    return isDisabled;
                }""",
                disabled_classes,
            )
            return not is_disabled
        else:
            # For Selenium
            element = await get_locator_or_element(page, engine, selector)
            if not element:
                return False

            # Check if element is enabled
            if not element.is_enabled():
                return False

            # Check for aria-disabled
            aria_disabled = element.get_attribute("aria-disabled")
            if aria_disabled == "true":
                return False

            # Check for disabled classes
            class_attr = element.get_attribute("class") or ""
            return all(cls not in class_attr for cls in disabled_classes)
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during enabled check, returning False")
        return False


async def count(
    page: Any,
    engine: EngineType,
    selector: str | Any,
) -> int:
    """Get element count.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or special text selector

    Returns:
        Number of matching elements
    """
    if not selector:
        raise ValueError("selector is required")

    try:
        # Handle Selenium text selectors
        from browser_commander.elements.selectors import SeleniumTextSelector

        if engine == "selenium" and isinstance(selector, SeleniumTextSelector):
            script = """
                const [baseSelector, text, exact] = arguments;
                const elements = Array.from(document.querySelectorAll(baseSelector));
                return elements.filter(el => {
                    const elementText = el.textContent.trim();
                    return exact ? elementText === text : elementText.includes(text);
                }).length;
            """
            result = page.execute_script(
                script,
                selector.base_selector,
                selector.text,
                selector.exact,
            )
            return result

        if engine == "playwright":
            return await page.locator(selector).count()
        else:
            from selenium.webdriver.common.by import By

            elements = page.find_elements(By.CSS_SELECTOR, selector)
            return len(elements)
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during element count, returning 0")
            return 0
        raise
