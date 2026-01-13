"""Locator utilities for browser-commander.

This module provides functions for creating and working with element locators
across both Playwright and Selenium engines.
"""

from __future__ import annotations

import re
from typing import Any

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.navigation_safety import is_navigation_error


def create_playwright_locator(page: Any, selector: str) -> Any:
    """Create Playwright locator from selector string.

    Handles :nth-of-type() pseudo-selectors which don't work in Playwright locators.

    Args:
        page: Browser page object
        selector: CSS selector

    Returns:
        Playwright locator
    """
    if not selector:
        raise ValueError("selector is required")

    # Check if selector has :nth-of-type(n) pattern
    nth_of_type_match = re.match(r"^(.+):nth-of-type\((\d+)\)$", selector)

    if nth_of_type_match:
        base_selector = nth_of_type_match.group(1)
        index = int(nth_of_type_match.group(2)) - 1  # Convert to 0-based index
        return page.locator(base_selector).nth(index)

    return page.locator(selector)


async def get_locator_or_element(
    page: Any,
    engine: EngineType,
    selector: str | Any,
) -> Any | None:
    """Get locator/element from selector (unified helper for both engines).

    Does NOT wait - use wait_for_locator_or_element() if you need to wait.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or element/locator

    Returns:
        Locator for Playwright, Element for Selenium (can be None)
    """
    if not selector:
        raise ValueError("selector is required")

    if not isinstance(selector, str):
        return selector  # Already a locator/element

    if engine == "playwright":
        return create_playwright_locator(page, selector)
    else:
        # For Selenium, find element (can return None)
        from selenium.common.exceptions import NoSuchElementException

        try:
            from selenium.webdriver.common.by import By

            return page.find_element(By.CSS_SELECTOR, selector)
        except NoSuchElementException:
            return None


async def wait_for_locator_or_element(
    page: Any,
    engine: EngineType,
    selector: str | Any,
    timeout: int | None = None,
    throw_on_navigation: bool = True,
) -> Any | None:
    """Get locator/element and wait for it to be visible.

    Unified waiting behavior for both engines.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or existing locator/element
        timeout: Timeout in ms (default: TIMING.DEFAULT_TIMEOUT)
        throw_on_navigation: Whether to throw on navigation error (default: True)

    Returns:
        Locator for Playwright (first match), Element for Selenium, or None on navigation

    Raises:
        Error if element not found or not visible within timeout
        (unless navigation error and throw_on_navigation is False)
    """
    if timeout is None:
        timeout = TIMING.get("DEFAULT_TIMEOUT", 5000)

    if not selector:
        raise ValueError("selector is required")

    try:
        if engine == "playwright":
            locator = await get_locator_or_element(page, engine, selector)
            # Use .first() to handle multiple matches (Playwright strict mode)
            first_locator = locator.first()
            await first_locator.wait_for(state="visible", timeout=timeout)
            return first_locator
        else:
            # Selenium: wait for element to be visible
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.support.ui import WebDriverWait

            wait = WebDriverWait(page, timeout / 1000)
            element = wait.until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, selector))
            )
            return element

    except Exception as error:
        if is_navigation_error(error):
            print(
                "Navigation detected during wait_for_locator_or_element, "
                "recovering gracefully"
            )
            if throw_on_navigation:
                raise
            return None
        raise


async def wait_for_visible(
    engine: EngineType,
    locator_or_element: Any,
    timeout: int | None = None,
) -> None:
    """Wait for element to be visible (works with existing locator_or_element).

    Args:
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Element or locator to wait for
        timeout: Timeout in ms (default: TIMING.DEFAULT_TIMEOUT)
    """
    if timeout is None:
        timeout = TIMING.get("DEFAULT_TIMEOUT", 5000)

    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    if engine == "playwright":
        await locator_or_element.wait_for(state="visible", timeout=timeout)
    else:
        # For Selenium, element is already fetched, just verify it exists
        if not locator_or_element:
            raise ValueError("Element not found")


class SeleniumLocatorWrapper:
    """Wrapper that mimics Playwright locator API for Selenium."""

    def __init__(self, page: Any, selector: str) -> None:
        """Initialize wrapper.

        Args:
            page: Selenium WebDriver instance
            selector: CSS selector
        """
        self._page = page
        self._selector = selector

    @property
    def selector(self) -> str:
        """Get the selector string."""
        return self._selector

    async def count(self) -> int:
        """Count matching elements."""
        from selenium.webdriver.common.by import By

        elements = self._page.find_elements(By.CSS_SELECTOR, self._selector)
        return len(elements)

    async def click(self, **kwargs: Any) -> None:
        """Click the element."""
        from selenium.webdriver.common.by import By

        element = self._page.find_element(By.CSS_SELECTOR, self._selector)
        element.click()

    async def fill(self, text: str) -> None:
        """Fill the element with text."""
        from selenium.webdriver.common.by import By

        element = self._page.find_element(By.CSS_SELECTOR, self._selector)
        element.clear()
        element.send_keys(text)

    async def type(self, text: str, **kwargs: Any) -> None:
        """Type text into the element."""
        from selenium.webdriver.common.by import By

        element = self._page.find_element(By.CSS_SELECTOR, self._selector)
        element.send_keys(text)

    async def text_content(self) -> str | None:
        """Get text content."""
        from selenium.common.exceptions import NoSuchElementException
        from selenium.webdriver.common.by import By

        try:
            element = self._page.find_element(By.CSS_SELECTOR, self._selector)
            return element.text
        except NoSuchElementException:
            return None

    async def input_value(self) -> str:
        """Get input value."""
        from selenium.common.exceptions import NoSuchElementException
        from selenium.webdriver.common.by import By

        try:
            element = self._page.find_element(By.CSS_SELECTOR, self._selector)
            return element.get_attribute("value") or ""
        except NoSuchElementException:
            return ""

    async def get_attribute(self, name: str) -> str | None:
        """Get attribute value."""
        from selenium.common.exceptions import NoSuchElementException
        from selenium.webdriver.common.by import By

        try:
            element = self._page.find_element(By.CSS_SELECTOR, self._selector)
            return element.get_attribute(name)
        except NoSuchElementException:
            return None

    async def is_visible(self) -> bool:
        """Check if element is visible."""
        from selenium.common.exceptions import NoSuchElementException
        from selenium.webdriver.common.by import By

        try:
            element = self._page.find_element(By.CSS_SELECTOR, self._selector)
            return element.is_displayed()
        except NoSuchElementException:
            return False

    async def wait_for(
        self,
        state: str = "visible",
        timeout: int | None = None,
    ) -> None:
        """Wait for element state."""
        if timeout is None:
            timeout = TIMING.get("DEFAULT_TIMEOUT", 5000)

        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait

        wait = WebDriverWait(self._page, timeout / 1000)
        if state == "visible":
            wait.until(
                EC.visibility_of_element_located((By.CSS_SELECTOR, self._selector))
            )
        elif state == "attached":
            wait.until(
                EC.presence_of_element_located((By.CSS_SELECTOR, self._selector))
            )
        elif state == "hidden":
            wait.until(
                EC.invisibility_of_element_located((By.CSS_SELECTOR, self._selector))
            )

    def nth(self, index: int) -> SeleniumLocatorWrapper:
        """Get nth element (0-based index)."""
        return SeleniumLocatorWrapper(
            self._page, f"{self._selector}:nth-of-type({index + 1})"
        )

    def first(self) -> SeleniumLocatorWrapper:
        """Get first element."""
        return SeleniumLocatorWrapper(self._page, f"{self._selector}:nth-of-type(1)")

    def last(self) -> SeleniumLocatorWrapper:
        """Get last element."""
        return SeleniumLocatorWrapper(self._page, f"{self._selector}:last-of-type")

    async def evaluate(self, fn: str, arg: Any = None) -> Any:
        """Evaluate JavaScript on element."""
        from selenium.webdriver.common.by import By

        element = self._page.find_element(By.CSS_SELECTOR, self._selector)
        if arg is not None:
            return self._page.execute_script(fn, element, arg)
        return self._page.execute_script(fn, element)


def locator(page: Any, engine: EngineType, selector: str) -> Any:
    """Create locator (Playwright-style fluent API).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector

    Returns:
        Locator object (Playwright) or wrapper (Selenium)
    """
    if not selector:
        raise ValueError("selector is required")

    if engine == "playwright":
        return create_playwright_locator(page, selector)
    else:
        return SeleniumLocatorWrapper(page, selector)
