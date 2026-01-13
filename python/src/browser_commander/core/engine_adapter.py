"""Engine Adapter - Abstract away Playwright/Selenium differences.

This module implements the Adapter pattern to encapsulate engine-specific
logic in a single place, following the "Protected Variations" principle.

Benefits:
- Eliminates scattered `if engine == 'playwright'` checks
- Easier to add new engines
- Easier to test with mock adapters
- Clearer separation of concerns
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType


class EngineAdapter(ABC):
    """Base class defining the engine adapter interface.

    All engine-specific operations should be defined here.
    """

    def __init__(self, page: Any) -> None:
        """Initialize the adapter with a page/driver object.

        Args:
            page: Playwright page or Selenium WebDriver
        """
        self.page = page

    @abstractmethod
    def get_engine_name(self) -> EngineType:
        """Get engine name.

        Returns:
            Engine type: 'playwright' or 'selenium'
        """
        ...

    # =========================================================================
    # Element Selection and Locators
    # =========================================================================

    @abstractmethod
    def create_locator(self, selector: str) -> Any:
        """Create a locator/element from a selector.

        Args:
            selector: CSS selector

        Returns:
            Locator (Playwright) or WebElement (Selenium)
        """
        ...

    @abstractmethod
    async def query_selector(self, selector: str) -> Any | None:
        """Query single element.

        Args:
            selector: CSS selector

        Returns:
            Locator/Element or None
        """
        ...

    @abstractmethod
    async def query_selector_all(self, selector: str) -> list[Any]:
        """Query all elements.

        Args:
            selector: CSS selector

        Returns:
            List of locators/elements
        """
        ...

    @abstractmethod
    async def wait_for_selector(
        self,
        selector: str,
        visible: bool = True,
        timeout: int = TIMING["DEFAULT_TIMEOUT"],
    ) -> None:
        """Wait for selector to appear.

        Args:
            selector: CSS selector
            visible: Wait for visibility
            timeout: Timeout in milliseconds
        """
        ...

    @abstractmethod
    async def wait_for_visible(
        self,
        locator_or_element: Any,
        timeout: int = TIMING["DEFAULT_TIMEOUT"],
    ) -> Any:
        """Wait for element to be visible.

        Args:
            locator_or_element: Locator or element
            timeout: Timeout in milliseconds

        Returns:
            The locator/element
        """
        ...

    @abstractmethod
    async def count(self, selector: str) -> int:
        """Count matching elements.

        Args:
            selector: CSS selector

        Returns:
            Number of matching elements
        """
        ...

    # =========================================================================
    # Element Evaluation and Properties
    # =========================================================================

    @abstractmethod
    async def evaluate_on_element(
        self,
        locator_or_element: Any,
        script: str,
        *args: Any,
    ) -> Any:
        """Evaluate JavaScript on element.

        Args:
            locator_or_element: Locator or element
            script: JavaScript code to evaluate
            *args: Arguments to pass to the script

        Returns:
            Result of evaluation
        """
        ...

    @abstractmethod
    async def get_text_content(self, locator_or_element: Any) -> str | None:
        """Get element text content.

        Args:
            locator_or_element: Locator or element

        Returns:
            Text content or None
        """
        ...

    @abstractmethod
    async def get_input_value(self, locator_or_element: Any) -> str:
        """Get input value.

        Args:
            locator_or_element: Locator or element

        Returns:
            Input value
        """
        ...

    @abstractmethod
    async def get_attribute(
        self,
        locator_or_element: Any,
        attribute: str,
    ) -> str | None:
        """Get element attribute.

        Args:
            locator_or_element: Locator or element
            attribute: Attribute name

        Returns:
            Attribute value or None
        """
        ...

    # =========================================================================
    # Element Interactions
    # =========================================================================

    @abstractmethod
    async def click(
        self,
        locator_or_element: Any,
        force: bool = False,
    ) -> None:
        """Click element.

        Args:
            locator_or_element: Locator or element
            force: Force click without checks
        """
        ...

    @abstractmethod
    async def type_text(self, locator_or_element: Any, text: str) -> None:
        """Type text into element (simulates typing).

        Args:
            locator_or_element: Locator or element
            text: Text to type
        """
        ...

    @abstractmethod
    async def fill(self, locator_or_element: Any, text: str) -> None:
        """Fill element with text (direct value assignment).

        Args:
            locator_or_element: Locator or element
            text: Text to fill
        """
        ...

    @abstractmethod
    async def focus(self, locator_or_element: Any) -> None:
        """Focus element.

        Args:
            locator_or_element: Locator or element
        """
        ...

    # =========================================================================
    # Page-level Operations
    # =========================================================================

    @abstractmethod
    async def evaluate_on_page(self, script: str, *args: Any) -> Any:
        """Evaluate JavaScript in page context.

        Args:
            script: JavaScript code to evaluate
            *args: Arguments to pass to the script

        Returns:
            Result of evaluation
        """
        ...

    @abstractmethod
    def get_url(self) -> str:
        """Get current page URL.

        Returns:
            Current URL
        """
        ...

    @abstractmethod
    async def goto(
        self,
        url: str,
        timeout: int = TIMING["NAVIGATION_TIMEOUT"],
    ) -> None:
        """Navigate to URL.

        Args:
            url: URL to navigate to
            timeout: Timeout in milliseconds
        """
        ...


class PlaywrightAdapter(EngineAdapter):
    """Playwright adapter implementation."""

    def get_engine_name(self) -> EngineType:
        """Get engine name."""
        return "playwright"

    def create_locator(self, selector: str) -> Any:
        """Create a Playwright locator."""
        # Handle :nth-of-type() pseudo-selectors
        import re

        match = re.match(r"^(.+):nth-of-type\((\d+)\)$", selector)
        if match:
            base_selector = match.group(1)
            index = int(match.group(2)) - 1  # Convert to 0-based
            return self.page.locator(base_selector).nth(index)
        return self.page.locator(selector)

    async def query_selector(self, selector: str) -> Any | None:
        """Query single element."""
        locator = self.create_locator(selector).first
        count = await locator.count()
        return locator if count > 0 else None

    async def query_selector_all(self, selector: str) -> list[Any]:
        """Query all elements."""
        locator = self.create_locator(selector)
        count = await locator.count()
        return [locator.nth(i) for i in range(count)]

    async def wait_for_selector(
        self,
        selector: str,
        visible: bool = True,
        timeout: int = TIMING["DEFAULT_TIMEOUT"],
    ) -> None:
        """Wait for selector to appear."""
        locator = self.create_locator(selector)
        state = "visible" if visible else "attached"
        await locator.wait_for(state=state, timeout=timeout)

    async def wait_for_visible(
        self,
        locator_or_element: Any,
        timeout: int = TIMING["DEFAULT_TIMEOUT"],
    ) -> Any:
        """Wait for element to be visible."""
        first_locator = locator_or_element.first
        await first_locator.wait_for(state="visible", timeout=timeout)
        return first_locator

    async def count(self, selector: str) -> int:
        """Count matching elements."""
        return await self.page.locator(selector).count()

    async def evaluate_on_element(
        self,
        locator_or_element: Any,
        script: str,
        *args: Any,
    ) -> Any:
        """Evaluate JavaScript on element."""
        if args:
            return await locator_or_element.evaluate(script, args[0])
        return await locator_or_element.evaluate(script)

    async def get_text_content(self, locator_or_element: Any) -> str | None:
        """Get element text content."""
        return await locator_or_element.text_content()

    async def get_input_value(self, locator_or_element: Any) -> str:
        """Get input value."""
        return await locator_or_element.input_value()

    async def get_attribute(
        self,
        locator_or_element: Any,
        attribute: str,
    ) -> str | None:
        """Get element attribute."""
        return await locator_or_element.get_attribute(attribute)

    async def click(
        self,
        locator_or_element: Any,
        force: bool = False,
    ) -> None:
        """Click element."""
        await locator_or_element.click(force=force)

    async def type_text(self, locator_or_element: Any, text: str) -> None:
        """Type text into element."""
        await locator_or_element.type(text)

    async def fill(self, locator_or_element: Any, text: str) -> None:
        """Fill element with text."""
        await locator_or_element.fill(text)

    async def focus(self, locator_or_element: Any) -> None:
        """Focus element."""
        await locator_or_element.focus()

    async def evaluate_on_page(self, script: str, *args: Any) -> Any:
        """Evaluate JavaScript in page context."""
        if not args:
            return await self.page.evaluate(script)
        if len(args) == 1:
            return await self.page.evaluate(script, args[0])
        # Multiple args - pass as array
        return await self.page.evaluate(script, list(args))

    def get_url(self) -> str:
        """Get current page URL."""
        return self.page.url

    async def goto(
        self,
        url: str,
        timeout: int = TIMING["NAVIGATION_TIMEOUT"],
    ) -> None:
        """Navigate to URL."""
        await self.page.goto(url, timeout=timeout)


class SeleniumAdapter(EngineAdapter):
    """Selenium adapter implementation."""

    def get_engine_name(self) -> EngineType:
        """Get engine name."""
        return "selenium"

    def create_locator(self, selector: str) -> Any:
        """Create a Selenium element locator (returns the selector for later use)."""
        # Selenium doesn't have locators - just return the selector
        return selector

    async def query_selector(self, selector: str) -> Any | None:
        """Query single element."""
        from selenium.common.exceptions import NoSuchElementException
        from selenium.webdriver.common.by import By

        try:
            return self.page.find_element(By.CSS_SELECTOR, selector)
        except NoSuchElementException:
            return None

    async def query_selector_all(self, selector: str) -> list[Any]:
        """Query all elements."""
        from selenium.webdriver.common.by import By

        return self.page.find_elements(By.CSS_SELECTOR, selector)

    async def wait_for_selector(
        self,
        selector: str,
        visible: bool = True,
        timeout: int = TIMING["DEFAULT_TIMEOUT"],
    ) -> None:
        """Wait for selector to appear."""
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait

        timeout_seconds = timeout / 1000
        wait = WebDriverWait(self.page, timeout_seconds)

        if visible:
            wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, selector)))
        else:
            wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, selector)))

    async def wait_for_visible(
        self,
        locator_or_element: Any,
        timeout: int = TIMING["DEFAULT_TIMEOUT"],
    ) -> Any:
        """Wait for element to be visible."""
        from selenium.webdriver.support import expected_conditions as EC
        from selenium.webdriver.support.ui import WebDriverWait

        timeout_seconds = timeout / 1000
        wait = WebDriverWait(self.page, timeout_seconds)
        return wait.until(EC.visibility_of(locator_or_element))

    async def count(self, selector: str) -> int:
        """Count matching elements."""
        elements = await self.query_selector_all(selector)
        return len(elements)

    async def evaluate_on_element(
        self,
        locator_or_element: Any,
        script: str,
        *args: Any,
    ) -> Any:
        """Evaluate JavaScript on element."""
        # Wrap the script to work with Selenium's execute_script
        wrapped_script = f"return (function(el, ...args) {{ {script} }})(arguments[0], ...Array.from(arguments).slice(1))"
        return self.page.execute_script(wrapped_script, locator_or_element, *args)

    async def get_text_content(self, locator_or_element: Any) -> str | None:
        """Get element text content."""
        return locator_or_element.text

    async def get_input_value(self, locator_or_element: Any) -> str:
        """Get input value."""
        return locator_or_element.get_attribute("value") or ""

    async def get_attribute(
        self,
        locator_or_element: Any,
        attribute: str,
    ) -> str | None:
        """Get element attribute."""
        return locator_or_element.get_attribute(attribute)

    async def click(
        self,
        locator_or_element: Any,
        force: bool = False,
    ) -> None:
        """Click element."""
        if force:
            # Use JavaScript click for force mode
            self.page.execute_script("arguments[0].click()", locator_or_element)
        else:
            locator_or_element.click()

    async def type_text(self, locator_or_element: Any, text: str) -> None:
        """Type text into element."""
        locator_or_element.send_keys(text)

    async def fill(self, locator_or_element: Any, text: str) -> None:
        """Fill element with text."""
        locator_or_element.clear()
        locator_or_element.send_keys(text)

    async def focus(self, locator_or_element: Any) -> None:
        """Focus element."""
        self.page.execute_script("arguments[0].focus()", locator_or_element)

    async def evaluate_on_page(self, script: str, *args: Any) -> Any:
        """Evaluate JavaScript in page context."""
        wrapped_script = f"return (function(...args) {{ {script} }})(...arguments)"
        return self.page.execute_script(wrapped_script, *args)

    def get_url(self) -> str:
        """Get current page URL."""
        return self.page.current_url

    async def goto(
        self,
        url: str,
        timeout: int = TIMING["NAVIGATION_TIMEOUT"],
    ) -> None:
        """Navigate to URL."""
        self.page.set_page_load_timeout(timeout / 1000)
        self.page.get(url)


def create_engine_adapter(page: Any, engine: EngineType) -> EngineAdapter:
    """Factory function to create appropriate adapter.

    Args:
        page: Playwright page or Selenium WebDriver object
        engine: Engine type ('playwright' or 'selenium')

    Returns:
        Appropriate adapter instance

    Raises:
        ValueError: If page is None or engine is unsupported
    """
    if page is None:
        msg = "page is required in create_engine_adapter"
        raise ValueError(msg)

    if engine == "playwright":
        return PlaywrightAdapter(page)
    if engine == "selenium":
        return SeleniumAdapter(page)

    msg = f"Unsupported engine: {engine}. Expected 'playwright' or 'selenium'"
    raise ValueError(msg)
