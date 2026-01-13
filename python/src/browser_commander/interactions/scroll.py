"""Scroll interactions for browser-commander.

This module provides scrolling functions for both Playwright and Selenium engines.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.core.page_trigger_manager import is_action_stopped_error

# JavaScript function for checking if scrolling is needed
NEEDS_SCROLLING_JS = """
(el, thresholdPercent) => {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const elementCenter = rect.top + rect.height / 2;
    const viewportCenter = viewportHeight / 2;
    const distanceFromCenter = Math.abs(elementCenter - viewportCenter);
    const thresholdPixels = (viewportHeight * thresholdPercent) / 100;

    const isVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
    const isWithinThreshold = distanceFromCenter <= thresholdPixels;

    return !isVisible || !isWithinThreshold;
}
"""

# JavaScript function for verifying element is in viewport
IS_ELEMENT_IN_VIEWPORT_JS = """
(el, margin) => {
    const rect = el.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const isInVerticalView = rect.top < (viewportHeight - margin) && rect.bottom > margin;
    const isInHorizontalView = rect.left < (viewportWidth - margin) && rect.right > margin;

    return isInVerticalView && isInHorizontalView;
}
"""


@dataclass
class ScrollVerificationResult:
    """Result of scroll verification."""

    verified: bool
    in_viewport: bool
    navigation_error: bool = False
    attempts: int = 0


@dataclass
class ScrollResult:
    """Result of scroll operation."""

    scrolled: bool
    verified: bool
    skipped: bool = False


async def default_scroll_verification(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    margin: int = 50,
) -> ScrollVerificationResult:
    """Default verification function for scroll operations.

    Verifies that the element is now visible in the viewport.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Element that was scrolled to
        margin: Margin in pixels to consider element visible (default: 50)

    Returns:
        ScrollVerificationResult
    """
    try:
        if engine == "playwright":
            in_viewport = await locator_or_element.evaluate(
                IS_ELEMENT_IN_VIEWPORT_JS,
                margin,
            )
        else:
            # Selenium
            in_viewport = page.execute_script(
                f"return ({IS_ELEMENT_IN_VIEWPORT_JS})(arguments[0], arguments[1])",
                locator_or_element,
                margin,
            )
        return ScrollVerificationResult(verified=in_viewport, in_viewport=in_viewport)
    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            return ScrollVerificationResult(
                verified=False,
                in_viewport=False,
                navigation_error=True,
            )
        raise


async def verify_scroll(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    verify_fn: Callable | None = None,
    timeout: int | None = None,
    retry_interval: int | None = None,
    log: Logger | None = None,
) -> ScrollVerificationResult:
    """Verify scroll operation with retry logic.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element to verify
        verify_fn: Custom verification function (optional)
        timeout: Verification timeout in ms
        retry_interval: Interval between retries
        log: Logger instance

    Returns:
        ScrollVerificationResult
    """
    if timeout is None:
        timeout = TIMING.get("VERIFICATION_TIMEOUT", 5000)
    if retry_interval is None:
        retry_interval = TIMING.get("VERIFICATION_RETRY_INTERVAL", 100)
    if verify_fn is None:
        verify_fn = default_scroll_verification

    start_time = time.time()
    attempts = 0
    last_result = ScrollVerificationResult(verified=False, in_viewport=False)
    timeout_seconds = timeout / 1000

    while time.time() - start_time < timeout_seconds:
        attempts += 1
        last_result = await verify_fn(page, engine, locator_or_element)

        if last_result.verified:
            if log:
                log.debug(
                    lambda _a=attempts: f"Scroll verification succeeded after {_a} attempt(s)"
                )
            return ScrollVerificationResult(
                verified=True,
                in_viewport=last_result.in_viewport,
                attempts=attempts,
            )

        if last_result.navigation_error:
            if log:
                log.debug(lambda: "Navigation/stop detected during scroll verification")
            return ScrollVerificationResult(
                verified=False,
                in_viewport=False,
                navigation_error=True,
                attempts=attempts,
            )

        await asyncio.sleep(retry_interval / 1000)

    if log:
        log.debug(
            lambda: f"Scroll verification failed after {attempts} attempts - "
            "element not in viewport"
        )

    return ScrollVerificationResult(
        verified=False,
        in_viewport=last_result.in_viewport,
        attempts=attempts,
    )


async def scroll_into_view(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    behavior: str = "smooth",
    verify: bool = True,
    verify_fn: Callable | None = None,
    verification_timeout: int | None = None,
    log: Logger | None = None,
) -> ScrollResult:
    """Scroll element into view (low-level, does not check if scroll is needed).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Playwright locator or Selenium element
        behavior: 'smooth' or 'instant' (default: 'smooth')
        verify: Whether to verify the scroll operation (default: True)
        verify_fn: Custom verification function (optional)
        verification_timeout: Verification timeout in ms
        log: Logger instance (optional)

    Returns:
        ScrollResult
    """
    if verification_timeout is None:
        verification_timeout = TIMING.get("VERIFICATION_TIMEOUT", 5000)

    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    try:
        scroll_js = """
        (el, scrollBehavior) => {
            el.scrollIntoView({
                behavior: scrollBehavior,
                block: 'center',
                inline: 'center',
            });
        }
        """

        if engine == "playwright":
            await locator_or_element.evaluate(scroll_js, behavior)
        else:
            # Selenium
            page.execute_script(
                f"({scroll_js})(arguments[0], arguments[1])",
                locator_or_element,
                behavior,
            )

        # Verify scroll if requested
        if verify:
            verification_result = await verify_scroll(
                page=page,
                engine=engine,
                locator_or_element=locator_or_element,
                verify_fn=verify_fn,
                timeout=verification_timeout,
                log=log,
            )

            return ScrollResult(
                scrolled=True,
                verified=verification_result.verified,
            )

        return ScrollResult(scrolled=True, verified=True)

    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            print("Navigation/stop detected during scroll_into_view, skipping")
            return ScrollResult(scrolled=False, verified=False)
        raise


async def needs_scrolling(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    threshold: int = 10,
) -> bool:
    """Check if element needs scrolling (is it more than threshold% away from viewport center).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Playwright locator or Selenium element
        threshold: Percentage of viewport height to consider "significant" (default: 10)

    Returns:
        True if scroll is needed, False on navigation/stop
    """
    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    try:
        if engine == "playwright":
            return await locator_or_element.evaluate(NEEDS_SCROLLING_JS, threshold)
        else:
            # Selenium
            return page.execute_script(
                f"return ({NEEDS_SCROLLING_JS})(arguments[0], arguments[1])",
                locator_or_element,
                threshold,
            )
    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            print("Navigation/stop detected during needs_scrolling, returning False")
            return False
        raise


async def scroll_into_view_if_needed(
    page: Any,
    engine: EngineType,
    wait_fn: Callable[[int, str], Any],
    log: Logger,
    locator_or_element: Any,
    behavior: str = "smooth",
    threshold: int = 10,
    wait_after_scroll: int | None = None,
    verify: bool = True,
    verify_fn: Callable | None = None,
    verification_timeout: int | None = None,
) -> ScrollResult:
    """Scroll element into view only if needed (>threshold% from center).

    Automatically waits for scroll animation if scroll was performed.

    Args:
        page: Browser page object
        engine: Engine type
        wait_fn: Wait function (ms, reason) -> Any
        log: Logger instance
        locator_or_element: Playwright locator or Selenium element
        behavior: 'smooth' or 'instant' (default: 'smooth')
        threshold: Percentage of viewport height to consider "significant" (default: 10)
        wait_after_scroll: Wait time after scroll in ms
        verify: Whether to verify the scroll operation (default: True)
        verify_fn: Custom verification function (optional)
        verification_timeout: Verification timeout in ms

    Returns:
        ScrollResult
    """
    if wait_after_scroll is None:
        wait_after_scroll = (
            TIMING.get("SCROLL_ANIMATION_WAIT", 300) if behavior == "smooth" else 0
        )
    if verification_timeout is None:
        verification_timeout = TIMING.get("VERIFICATION_TIMEOUT", 5000)

    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    # Check if scrolling is needed
    needs_scroll = await needs_scrolling(
        page=page,
        engine=engine,
        locator_or_element=locator_or_element,
        threshold=threshold,
    )

    if not needs_scroll:
        log.debug(
            lambda: f"Element already in view (within {threshold}% threshold), "
            "skipping scroll"
        )
        return ScrollResult(scrolled=False, verified=True, skipped=True)

    # Perform scroll with verification
    log.debug(lambda: f"Scrolling with behavior: {behavior}")
    scroll_result = await scroll_into_view(
        page=page,
        engine=engine,
        locator_or_element=locator_or_element,
        behavior=behavior,
        verify=verify,
        verify_fn=verify_fn,
        verification_timeout=verification_timeout,
        log=log,
    )

    if not scroll_result.scrolled:
        # Navigation/stop occurred during scroll
        return ScrollResult(scrolled=False, verified=False, skipped=False)

    # Wait for scroll animation if specified
    if wait_after_scroll > 0:
        await wait_fn(wait_after_scroll, f"{behavior} scroll animation to complete")

    if scroll_result.verified:
        log.debug(lambda: "Scroll verification passed - element is in viewport")
    else:
        log.debug(
            lambda: "Scroll verification failed - element may not be fully in viewport"
        )

    return ScrollResult(
        scrolled=True,
        verified=scroll_result.verified,
        skipped=False,
    )
