"""Browser Commander - Factory Function.

This module provides the make_browser_commander factory function that creates
a browser commander instance with all bound methods.
"""

from __future__ import annotations

import asyncio
from typing import Any

from browser_commander.core.engine_detection import EngineType, detect_engine
from browser_commander.core.logger import Logger, create_logger
from browser_commander.core.navigation_manager import NavigationManager
from browser_commander.core.network_tracker import NetworkTracker
from browser_commander.core.page_trigger_manager import (
    ActionStoppedError,
    PageTriggerManager,
    all_conditions,
    any_condition,
    is_action_stopped_error,
    make_url_condition,
    not_condition,
)


class BrowserCommander:
    """Browser Commander instance providing a unified browser automation API."""

    def __init__(
        self,
        page: Any,
        verbose: bool = False,
        enable_network_tracking: bool = True,
        enable_navigation_manager: bool = True,
    ) -> None:
        """Initialize browser commander.

        Args:
            page: Playwright or Selenium page/driver object
            verbose: Enable verbose logging
            enable_network_tracking: Enable network request tracking (default: True)
            enable_navigation_manager: Enable navigation manager (default: True)
        """
        self.page = page
        self.engine: EngineType = detect_engine(page)
        self.log: Logger = create_logger(verbose=verbose)
        self._verbose = verbose

        # Create NetworkTracker if enabled
        self.network_tracker: NetworkTracker | None = None
        if enable_network_tracking:
            self.network_tracker = NetworkTracker(
                page=page,
                engine=self.engine,
                log=self.log,
                idle_timeout=30000,
            )
            self.network_tracker.start_tracking()

        # Create NavigationManager if enabled
        self.navigation_manager: NavigationManager | None = None
        self.page_trigger_manager: PageTriggerManager | None = None

        if enable_navigation_manager:
            self.navigation_manager = NavigationManager(
                page=page,
                engine=self.engine,
                log=self.log,
                network_tracker=self.network_tracker,
            )
            self.navigation_manager.start_listening()

            # Create PageTriggerManager
            self.page_trigger_manager = PageTriggerManager(
                navigation_manager=self.navigation_manager,
                log=self.log,
            )
            self.page_trigger_manager.initialize(self)

    # ==================== URL Condition Helpers ====================
    @staticmethod
    def make_url_condition(pattern: Any) -> Any:
        """Create URL condition from pattern."""
        return make_url_condition(pattern)

    @staticmethod
    def all_conditions(*conditions: Any) -> Any:
        """Combine conditions with AND logic."""
        return all_conditions(*conditions)

    @staticmethod
    def any_condition(*conditions: Any) -> Any:
        """Combine conditions with OR logic."""
        return any_condition(*conditions)

    @staticmethod
    def not_condition(condition: Any) -> Any:
        """Negate a condition."""
        return not_condition(condition)

    # Error classes for action control flow
    ActionStoppedError = ActionStoppedError

    @staticmethod
    def is_action_stopped_error(error: Exception) -> bool:
        """Check if error is ActionStoppedError."""
        return is_action_stopped_error(error)

    # ==================== Navigation Management ====================
    def should_abort(self) -> bool:
        """Check if current operation should abort due to navigation."""
        if self.navigation_manager:
            return self.navigation_manager.should_abort()
        return False

    def get_abort_signal(self) -> asyncio.Event | None:
        """Get abort signal for current navigation context."""
        if self.navigation_manager:
            return self.navigation_manager.get_abort_signal()
        return None

    # ==================== Page Trigger API ====================
    def page_trigger(self, config: dict) -> None:
        """Register a page trigger.

        Args:
            config: Trigger configuration with:
                - condition: URL condition (string, regex, or function)
                - action: Async function to run when condition matches
                - name: Optional trigger name for debugging
        """
        if not self.page_trigger_manager:
            raise RuntimeError("page_trigger requires enable_navigation_manager=True")
        self.page_trigger_manager.page_trigger(config)

    # ==================== Lifecycle ====================
    async def destroy(self) -> None:
        """Clean up all resources."""
        if self.page_trigger_manager:
            await self.page_trigger_manager.destroy()

        if self.network_tracker:
            self.network_tracker.stop_tracking()

        if self.navigation_manager:
            self.navigation_manager.stop_listening()

    # ==================== Wait Functions ====================
    async def wait(self, ms: int, reason: str | None = None) -> dict:
        """Wait for specified time.

        Args:
            ms: Milliseconds to wait
            reason: Reason for waiting (for logging)

        Returns:
            Dict with completed and aborted flags
        """
        from browser_commander.utilities.wait import wait

        abort_signal = self.get_abort_signal()
        result = await wait(
            log=self.log,
            ms=ms,
            reason=reason,
            abort_signal=abort_signal,
        )
        return {"completed": result.completed, "aborted": result.aborted}

    async def evaluate(self, fn: str, args: list | None = None) -> Any:
        """Evaluate JavaScript in page context.

        Args:
            fn: JavaScript function string
            args: Arguments to pass

        Returns:
            Result of evaluation
        """
        from browser_commander.utilities.wait import evaluate

        return await evaluate(
            page=self.page,
            engine=self.engine,
            fn=fn,
            args=args,
        )

    async def safe_evaluate(
        self,
        fn: str,
        args: list | None = None,
        default_value: Any = None,
        operation_name: str = "evaluate",
        silent: bool = False,
    ) -> dict:
        """Safe evaluate that catches navigation errors.

        Args:
            fn: JavaScript function string
            args: Arguments to pass
            default_value: Value to return on navigation error
            operation_name: Name for logging
            silent: Don't log warnings

        Returns:
            Dict with success, value, and navigation_error flags
        """
        from browser_commander.utilities.wait import safe_evaluate

        result = await safe_evaluate(
            page=self.page,
            engine=self.engine,
            fn=fn,
            args=args,
            default_value=default_value,
            operation_name=operation_name,
            silent=silent,
        )
        return {
            "success": result.success,
            "value": result.value,
            "navigation_error": result.navigation_error,
        }

    # ==================== URL Functions ====================
    def get_url(self) -> str:
        """Get current URL."""
        from browser_commander.utilities.url import get_url

        return get_url(self.page)

    async def unfocus_address_bar(self) -> None:
        """Unfocus address bar."""
        from browser_commander.utilities.url import unfocus_address_bar

        await unfocus_address_bar(self.page)

    # ==================== Navigation Functions ====================
    async def goto(
        self,
        url: str,
        wait_until: str = "domcontentloaded",
        timeout: int = 240000,
        verify: bool = True,
    ) -> dict:
        """Navigate to URL.

        Args:
            url: URL to navigate to
            wait_until: Wait until condition
            timeout: Navigation timeout in ms
            verify: Whether to verify navigation

        Returns:
            Dict with navigated, verified, actual_url, reason
        """
        from browser_commander.browser.navigation import goto

        result = await goto(
            page=self.page,
            url=url,
            navigation_manager=self.navigation_manager,
            log=self.log,
            wait_until=wait_until,
            timeout=timeout,
            verify=verify,
        )
        return {
            "navigated": result.navigated,
            "verified": result.verified,
            "actual_url": result.actual_url,
            "reason": result.reason,
        }

    async def wait_for_navigation(self, timeout: int | None = None) -> bool:
        """Wait for navigation to complete.

        Args:
            timeout: Timeout in ms

        Returns:
            True if navigation completed
        """
        from browser_commander.browser.navigation import wait_for_navigation

        return await wait_for_navigation(
            page=self.page,
            navigation_manager=self.navigation_manager,
            timeout=timeout,
        )

    async def wait_for_page_ready(
        self,
        timeout: int = 30000,
        reason: str = "page ready",
    ) -> bool:
        """Wait for page to be fully ready.

        Args:
            timeout: Maximum time to wait in ms
            reason: Reason for waiting

        Returns:
            True if ready
        """
        from browser_commander.browser.navigation import wait_for_page_ready

        return await wait_for_page_ready(
            page=self.page,
            navigation_manager=self.navigation_manager,
            network_tracker=self.network_tracker,
            log=self.log,
            wait_fn=lambda ms, r: self.wait(ms, r),
            timeout=timeout,
            reason=reason,
        )

    # ==================== Element Selection ====================
    async def query_selector(self, selector: str) -> Any:
        """Query single element.

        Args:
            selector: CSS selector

        Returns:
            Element or None
        """
        from browser_commander.elements.selectors import query_selector

        return await query_selector(self.page, self.engine, selector)

    async def query_selector_all(self, selector: str) -> list:
        """Query all elements.

        Args:
            selector: CSS selector

        Returns:
            List of elements
        """
        from browser_commander.elements.selectors import query_selector_all

        return await query_selector_all(self.page, self.engine, selector)

    async def wait_for_selector(
        self,
        selector: str,
        visible: bool = True,
        timeout: int | None = None,
    ) -> bool:
        """Wait for selector to appear.

        Args:
            selector: CSS selector
            visible: Wait for visibility
            timeout: Timeout in ms

        Returns:
            True if found
        """
        from browser_commander.elements.selectors import wait_for_selector

        return await wait_for_selector(
            page=self.page,
            engine=self.engine,
            selector=selector,
            visible=visible,
            timeout=timeout,
        )

    def find_by_text(
        self,
        text: str,
        selector: str = "*",
        exact: bool = False,
    ) -> Any:
        """Find elements by text content.

        Args:
            text: Text to search for
            selector: Base selector
            exact: Exact match vs contains

        Returns:
            Selector string or SeleniumTextSelector
        """
        from browser_commander.elements.selectors import find_by_text

        return find_by_text(self.engine, text, selector, exact)

    # ==================== Element Visibility ====================
    async def is_visible(self, selector: str) -> bool:
        """Check if element is visible.

        Args:
            selector: CSS selector

        Returns:
            True if visible
        """
        from browser_commander.elements.visibility import is_visible

        return await is_visible(self.page, self.engine, selector)

    async def is_enabled(
        self,
        selector: str,
        disabled_classes: list[str] | None = None,
    ) -> bool:
        """Check if element is enabled.

        Args:
            selector: CSS selector
            disabled_classes: Additional disabled class names

        Returns:
            True if enabled
        """
        from browser_commander.elements.visibility import is_enabled

        return await is_enabled(self.page, self.engine, selector, disabled_classes)

    async def count(self, selector: str) -> int:
        """Get element count.

        Args:
            selector: CSS selector

        Returns:
            Number of matching elements
        """
        from browser_commander.elements.visibility import count

        return await count(self.page, self.engine, selector)

    # ==================== Element Content ====================
    async def text_content(self, selector: str) -> str | None:
        """Get text content.

        Args:
            selector: CSS selector

        Returns:
            Text content or None
        """
        from browser_commander.elements.content import text_content

        return await text_content(self.page, self.engine, selector)

    async def input_value(self, selector: str) -> str:
        """Get input value.

        Args:
            selector: CSS selector

        Returns:
            Input value
        """
        from browser_commander.elements.content import input_value

        return await input_value(self.page, self.engine, selector)

    async def get_attribute(self, selector: str, attribute: str) -> str | None:
        """Get element attribute.

        Args:
            selector: CSS selector
            attribute: Attribute name

        Returns:
            Attribute value or None
        """
        from browser_commander.elements.content import get_attribute

        return await get_attribute(self.page, self.engine, selector, attribute)

    # ==================== Click Operations ====================
    async def click_button(
        self,
        selector: str,
        scroll_into_view: bool = True,
        wait_after_click: int = 1000,
        timeout: int | None = None,
        verify: bool = True,
    ) -> dict:
        """Click a button or element.

        Args:
            selector: CSS selector
            scroll_into_view: Scroll element into view
            wait_after_click: Wait time after click in ms
            timeout: Timeout in ms
            verify: Whether to verify click

        Returns:
            Dict with clicked, navigated, verified, reason
        """
        from browser_commander.interactions.click import click_button

        result = await click_button(
            page=self.page,
            engine=self.engine,
            wait_fn=lambda ms, r: self.wait(ms, r),
            log=self.log,
            selector=selector,
            verbose=self._verbose,
            navigation_manager=self.navigation_manager,
            network_tracker=self.network_tracker,
            scroll_into_view=scroll_into_view,
            wait_after_click=wait_after_click,
            timeout=timeout,
            verify=verify,
        )
        return {
            "clicked": result.clicked,
            "navigated": result.navigated,
            "verified": result.verified,
            "reason": result.reason,
        }

    # ==================== Fill Operations ====================
    async def fill_text_area(
        self,
        selector: str,
        text: str,
        check_empty: bool = True,
        scroll_into_view: bool = True,
        simulate_typing: bool = True,
        timeout: int | None = None,
        verify: bool = True,
    ) -> dict:
        """Fill a textarea with text.

        Args:
            selector: CSS selector
            text: Text to fill
            check_empty: Only fill if empty
            scroll_into_view: Scroll element into view
            simulate_typing: Simulate typing vs direct fill
            timeout: Timeout in ms
            verify: Whether to verify fill

        Returns:
            Dict with filled, verified, skipped, actual_value
        """
        from browser_commander.interactions.fill import fill_text_area

        result = await fill_text_area(
            page=self.page,
            engine=self.engine,
            wait_fn=lambda ms, r: self.wait(ms, r),
            log=self.log,
            selector=selector,
            text=text,
            check_empty=check_empty,
            scroll_into_view=scroll_into_view,
            simulate_typing=simulate_typing,
            timeout=timeout,
            verify=verify,
        )
        return {
            "filled": result.filled,
            "verified": result.verified,
            "skipped": result.skipped,
            "actual_value": result.actual_value,
        }

    # ==================== Scroll Operations ====================
    async def scroll_into_view(
        self,
        selector: str,
        behavior: str = "smooth",
        verify: bool = True,
    ) -> dict:
        """Scroll element into view.

        Args:
            selector: CSS selector
            behavior: 'smooth' or 'instant'
            verify: Whether to verify scroll

        Returns:
            Dict with scrolled and verified flags
        """
        from browser_commander.elements.locators import get_locator_or_element
        from browser_commander.interactions.scroll import scroll_into_view

        locator_or_element = await get_locator_or_element(
            self.page, self.engine, selector
        )
        result = await scroll_into_view(
            page=self.page,
            engine=self.engine,
            locator_or_element=locator_or_element,
            behavior=behavior,
            verify=verify,
            log=self.log,
        )
        return {"scrolled": result.scrolled, "verified": result.verified}


def make_browser_commander(
    page: Any,
    verbose: bool = False,
    enable_network_tracking: bool = True,
    enable_navigation_manager: bool = True,
) -> BrowserCommander:
    """Create a browser commander instance for a specific page.

    Args:
        page: Playwright or Selenium page object
        verbose: Enable verbose logging
        enable_network_tracking: Enable network request tracking (default: True)
        enable_navigation_manager: Enable navigation manager (default: True)

    Returns:
        BrowserCommander instance
    """
    return BrowserCommander(
        page=page,
        verbose=verbose,
        enable_network_tracking=enable_network_tracking,
        enable_navigation_manager=enable_navigation_manager,
    )
