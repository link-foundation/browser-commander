"""Selector utilities for browser-commander.

This module provides functions for querying and selecting elements
across both Playwright and Selenium engines.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.elements.locators import create_playwright_locator


@dataclass
class SeleniumTextSelector:
    """Special selector object for Selenium text-based queries."""

    base_selector: str
    text: str
    exact: bool


async def query_selector(
    page: Any,
    engine: EngineType,
    selector: str,
) -> Any | None:
    """Query single element.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector

    Returns:
        Element handle or None
    """
    if not selector:
        raise ValueError("selector is required")

    try:
        if engine == "playwright":
            locator = create_playwright_locator(page, selector).first()
            count = await locator.count()
            return locator if count > 0 else None
        else:
            from selenium.common.exceptions import NoSuchElementException
            from selenium.webdriver.common.by import By

            try:
                return page.find_element(By.CSS_SELECTOR, selector)
            except NoSuchElementException:
                return None
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during query_selector, returning None")
            return None
        raise


async def query_selector_all(
    page: Any,
    engine: EngineType,
    selector: str,
) -> list[Any]:
    """Query all elements.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector

    Returns:
        Array of element handles
    """
    if not selector:
        raise ValueError("selector is required")

    try:
        if engine == "playwright":
            locator = create_playwright_locator(page, selector)
            count = await locator.count()
            elements = []
            for i in range(count):
                elements.append(locator.nth(i))
            return elements
        else:
            from selenium.webdriver.common.by import By

            return page.find_elements(By.CSS_SELECTOR, selector)
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during query_selector_all, returning []")
            return []
        raise


def find_by_text(
    engine: EngineType,
    text: str,
    selector: str = "*",
    exact: bool = False,
) -> str | SeleniumTextSelector:
    """Find elements by text content (works across both engines).

    Args:
        engine: Engine type ('playwright' or 'selenium')
        text: Text to search for
        selector: Optional base selector (e.g., 'button', 'a', 'span')
        exact: Exact match vs contains (default: False)

    Returns:
        CSS selector string (for Playwright) or SeleniumTextSelector object
    """
    if not text:
        raise ValueError("text is required")

    if engine == "playwright":
        # Playwright supports :has-text() natively
        text_selector = f':text-is("{text}")' if exact else f':has-text("{text}")'
        return f"{selector}{text_selector}"
    else:
        # For Selenium, return a special selector object
        return SeleniumTextSelector(
            base_selector=selector,
            text=text,
            exact=exact,
        )


def is_playwright_text_selector(selector: Any) -> bool:
    """Check if a selector is a Playwright-specific text selector.

    Args:
        selector: The selector to check

    Returns:
        True if selector contains Playwright text pseudo-selectors
    """
    if not isinstance(selector, str):
        return False
    return ":has-text(" in selector or ":text-is(" in selector


def parse_playwright_text_selector(selector: str) -> dict | None:
    """Parse a Playwright text selector to extract base selector and text.

    Args:
        selector: Playwright text selector like 'a:has-text("text")'

    Returns:
        Dictionary with base_selector, text, exact or None if not parseable
    """
    # Match patterns like 'a:has-text("text")' or 'button:text-is("exact text")'
    has_text_match = re.match(r'^(.+?):has-text\("(.+?)"\)$', selector)
    if has_text_match:
        return {
            "base_selector": has_text_match.group(1),
            "text": has_text_match.group(2),
            "exact": False,
        }

    text_is_match = re.match(r'^(.+?):text-is\("(.+?)"\)$', selector)
    if text_is_match:
        return {
            "base_selector": text_is_match.group(1),
            "text": text_is_match.group(2),
            "exact": True,
        }

    return None


async def normalize_selector(
    page: Any,
    engine: EngineType,
    selector: str | SeleniumTextSelector,
) -> str | None:
    """Normalize selector to handle both Selenium and Playwright text selectors.

    Converts engine-specific text selectors to valid CSS selectors for browser context.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector or text selector object

    Returns:
        Valid CSS selector or None if not found
    """
    if not selector:
        raise ValueError("selector is required")

    # Handle Playwright text selectors (strings containing :has-text or :text-is)
    if (
        isinstance(selector, str)
        and engine == "playwright"
        and is_playwright_text_selector(selector)
    ):
        parsed = parse_playwright_text_selector(selector)
        if not parsed:
            return selector

        try:
            # Use page.evaluate to find matching element
            result = await page.evaluate(
                """({ baseSelector, text, exact }) => {
                    const elements = Array.from(document.querySelectorAll(baseSelector));
                    const matchingElement = elements.find(el => {
                        const elementText = el.textContent.trim();
                        return exact ? elementText === text : elementText.includes(text);
                    });

                    if (!matchingElement) {
                        return null;
                    }

                    // Generate a unique selector using data-qa or nth-of-type
                    const dataQa = matchingElement.getAttribute('data-qa');
                    if (dataQa) {
                        return `[data-qa="${dataQa}"]`;
                    }

                    // Use nth-of-type as fallback
                    const tagName = matchingElement.tagName.toLowerCase();
                    const siblings = Array.from(matchingElement.parentElement.children)
                        .filter(el => el.tagName.toLowerCase() === tagName);
                    const index = siblings.indexOf(matchingElement);
                    return `${tagName}:nth-of-type(${index + 1})`;
                }""",
                {
                    "baseSelector": parsed["base_selector"],
                    "text": parsed["text"],
                    "exact": parsed["exact"],
                },
            )
            return result
        except Exception as error:
            if is_navigation_error(error):
                print(
                    "Navigation detected during normalize_selector (Playwright), "
                    "returning None"
                )
                return None
            raise

    # Plain string selector - return as-is
    if isinstance(selector, str):
        return selector

    # Handle Selenium text selector objects
    if isinstance(selector, SeleniumTextSelector):
        try:
            # Find element by text and generate a unique selector
            script = """
                const [baseSelector, text, exact] = arguments;
                const elements = Array.from(document.querySelectorAll(baseSelector));
                const matchingElement = elements.find(el => {
                    const elementText = el.textContent.trim();
                    return exact ? elementText === text : elementText.includes(text);
                });

                if (!matchingElement) {
                    return null;
                }

                // Generate a unique selector using data-qa or nth-of-type
                const dataQa = matchingElement.getAttribute('data-qa');
                if (dataQa) {
                    return `[data-qa="${dataQa}"]`;
                }

                // Use nth-of-type as fallback
                const tagName = matchingElement.tagName.toLowerCase();
                const siblings = Array.from(matchingElement.parentElement.children)
                    .filter(el => el.tagName.toLowerCase() === tagName);
                const index = siblings.indexOf(matchingElement);
                return `${tagName}:nth-of-type(${index + 1})`;
            """
            result = page.execute_script(
                script,
                selector.base_selector,
                selector.text,
                selector.exact,
            )
            return result
        except Exception as error:
            if is_navigation_error(error):
                print(
                    "Navigation detected during normalize_selector (Selenium), "
                    "returning None"
                )
                return None
            raise

    return str(selector)


def with_text_selector_support(
    fn: Callable,
    engine: EngineType,
    page: Any,
) -> Callable:
    """Enhanced wrapper for functions that need to handle text selectors.

    Args:
        fn: The function to wrap
        engine: Engine type ('playwright' or 'selenium')
        page: Browser page object

    Returns:
        Wrapped function
    """

    async def wrapper(**kwargs: Any) -> Any:
        selector = kwargs.get("selector")

        # Normalize Selenium text selectors (object format)
        if engine == "selenium" and isinstance(selector, SeleniumTextSelector):
            selector = await normalize_selector(page, engine, selector)
            if not selector:
                raise ValueError("Element with specified text not found")
            kwargs["selector"] = selector

        # Normalize Playwright text selectors
        if (
            engine == "playwright"
            and isinstance(selector, str)
            and is_playwright_text_selector(selector)
        ):
            selector = await normalize_selector(page, engine, selector)
            if not selector:
                raise ValueError("Element with specified text not found")
            kwargs["selector"] = selector

        return await fn(**kwargs)

    return wrapper


async def wait_for_selector(
    page: Any,
    engine: EngineType,
    selector: str,
    visible: bool = True,
    timeout: int | None = None,
    throw_on_navigation: bool = True,
) -> bool:
    """Wait for selector to appear.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        selector: CSS selector
        visible: Wait for visibility (default: True)
        timeout: Timeout in ms (default: TIMING.DEFAULT_TIMEOUT)
        throw_on_navigation: Throw on navigation error (default: True)

    Returns:
        True if selector found, False on navigation
    """
    if timeout is None:
        timeout = TIMING.get("DEFAULT_TIMEOUT", 5000)

    if not selector:
        raise ValueError("selector is required")

    try:
        if engine == "playwright":
            locator = create_playwright_locator(page, selector)
            await locator.wait_for(
                state="visible" if visible else "attached",
                timeout=timeout,
            )
        else:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support import expected_conditions as EC
            from selenium.webdriver.support.ui import WebDriverWait

            wait = WebDriverWait(page, timeout / 1000)
            if visible:
                wait.until(
                    EC.visibility_of_element_located((By.CSS_SELECTOR, selector))
                )
            else:
                wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, selector)))
        return True
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during wait_for_selector, recovering gracefully")
            if throw_on_navigation:
                raise
            return False
        raise
