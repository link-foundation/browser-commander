"""Fill interactions for browser-commander.

This module provides fill/type functions for both Playwright and Selenium engines.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.elements.content import get_input_value
from browser_commander.elements.locators import wait_for_locator_or_element
from browser_commander.interactions.click import click_element
from browser_commander.interactions.scroll import scroll_into_view_if_needed


@dataclass
class FillVerificationResult:
    """Result of fill verification."""

    verified: bool
    actual_value: str
    navigation_error: bool = False
    attempts: int = 0


@dataclass
class FillResult:
    """Result of fill operation."""

    filled: bool
    verified: bool
    skipped: bool = False
    actual_value: str = ""


async def default_fill_verification(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    expected_text: str,
) -> FillVerificationResult:
    """Default verification function for fill operations.

    Verifies that the filled text matches expected text.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Element that was filled
        expected_text: Text that should be in the element

    Returns:
        FillVerificationResult
    """
    try:
        actual_value = await get_input_value(
            page=page,
            engine=engine,
            locator_or_element=locator_or_element,
        )
        # Verify that the value contains the expected text
        verified = actual_value == expected_text or expected_text in actual_value
        return FillVerificationResult(verified=verified, actual_value=actual_value)
    except Exception as error:
        if is_navigation_error(error):
            return FillVerificationResult(
                verified=False,
                actual_value="",
                navigation_error=True,
            )
        raise


async def verify_fill(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    expected_text: str,
    verify_fn: Callable | None = None,
    timeout: int | None = None,
    retry_interval: int | None = None,
    log: Logger | None = None,
) -> FillVerificationResult:
    """Verify fill operation with retry logic.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element to verify
        expected_text: Expected text value
        verify_fn: Custom verification function (optional)
        timeout: Verification timeout in ms
        retry_interval: Interval between retries
        log: Logger instance

    Returns:
        FillVerificationResult
    """
    if timeout is None:
        timeout = TIMING.get("VERIFICATION_TIMEOUT", 5000)
    if retry_interval is None:
        retry_interval = TIMING.get("VERIFICATION_RETRY_INTERVAL", 100)
    if verify_fn is None:
        verify_fn = default_fill_verification

    start_time = time.time()
    attempts = 0
    last_result = FillVerificationResult(verified=False, actual_value="")
    timeout_seconds = timeout / 1000

    while time.time() - start_time < timeout_seconds:
        attempts += 1
        last_result = await verify_fn(
            page=page,
            engine=engine,
            locator_or_element=locator_or_element,
            expected_text=expected_text,
        )

        if last_result.verified:
            if log:
                log.debug(
                    lambda _a=attempts: f"Fill verification succeeded after {_a} attempt(s)"
                )
            return FillVerificationResult(
                verified=True,
                actual_value=last_result.actual_value,
                attempts=attempts,
            )

        if last_result.navigation_error:
            if log:
                log.debug(lambda: "Navigation detected during fill verification")
            return FillVerificationResult(
                verified=False,
                actual_value="",
                navigation_error=True,
                attempts=attempts,
            )

        await asyncio.sleep(retry_interval / 1000)

    if log:
        log.debug(
            lambda: f"Fill verification failed after {attempts} attempts. "
            f'Expected: "{expected_text}", Got: "{last_result.actual_value}"'
        )

    return FillVerificationResult(
        verified=False,
        actual_value=last_result.actual_value,
        attempts=attempts,
    )


async def check_if_element_empty(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    adapter: Any | None = None,
) -> bool:
    """Check if an input element is empty.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Element or locator to check
        adapter: Engine adapter (optional)

    Returns:
        True if empty, False if has content (returns True on navigation)
    """
    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        current_value = await adapter.get_input_value(locator_or_element)
        return not current_value or current_value.strip() == ""
    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during check_if_element_empty, returning True")
            return True
        raise


async def perform_fill(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    text: str,
    simulate_typing: bool = True,
    verify: bool = True,
    verify_fn: Callable | None = None,
    verification_timeout: int | None = None,
    log: Logger | None = None,
    adapter: Any | None = None,
) -> FillResult:
    """Perform fill/type operation on an element (low-level).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Element or locator to fill
        text: Text to fill
        simulate_typing: Whether to simulate typing (default: True)
        verify: Whether to verify the fill operation (default: True)
        verify_fn: Custom verification function (optional)
        verification_timeout: Verification timeout in ms
        log: Logger instance (optional)
        adapter: Engine adapter (optional)

    Returns:
        FillResult
    """
    if verification_timeout is None:
        verification_timeout = TIMING.get("VERIFICATION_TIMEOUT", 5000)

    if not text:
        raise ValueError("text is required")
    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        if simulate_typing:
            await adapter.type(locator_or_element, text)
        else:
            await adapter.fill(locator_or_element, text)

        # Verify fill if requested
        if verify:
            verification_result = await verify_fill(
                page=page,
                engine=engine,
                locator_or_element=locator_or_element,
                expected_text=text,
                verify_fn=verify_fn,
                timeout=verification_timeout,
                log=log,
            )

            if not verification_result.verified and log:
                log.debug(
                    lambda: f'Fill verification failed: expected "{text}", '
                    f'got "{verification_result.actual_value}"'
                )

            return FillResult(
                filled=True,
                verified=verification_result.verified,
                actual_value=verification_result.actual_value,
            )

        return FillResult(filled=True, verified=True)

    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during perform_fill, recovering gracefully")
            return FillResult(filled=False, verified=False)
        raise


async def fill_text_area(
    page: Any,
    engine: EngineType,
    wait_fn: Callable[[int, str], Any],
    log: Logger,
    selector: str | Any,
    text: str,
    check_empty: bool = True,
    scroll_into_view: bool = True,
    simulate_typing: bool = True,
    timeout: int | None = None,
    verify: bool = True,
    verify_fn: Callable | None = None,
    verification_timeout: int | None = None,
) -> FillResult:
    """Fill a textarea with text (high-level with checks and scrolling).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        wait_fn: Wait function (ms, reason) -> Any
        log: Logger instance
        selector: CSS selector or Playwright Locator
        text: Text to fill
        check_empty: Only fill if empty (default: True)
        scroll_into_view: Scroll into view (default: True)
        simulate_typing: Simulate typing vs direct fill (default: True)
        timeout: Timeout in ms
        verify: Whether to verify the fill operation (default: True)
        verify_fn: Custom verification function (optional)
        verification_timeout: Verification timeout in ms

    Returns:
        FillResult
    """
    if timeout is None:
        timeout = TIMING.get("DEFAULT_TIMEOUT", 5000)
    if verification_timeout is None:
        verification_timeout = TIMING.get("VERIFICATION_TIMEOUT", 5000)

    if not selector or not text:
        raise ValueError("selector and text are required")

    try:
        # Get locator/element and wait for it to be visible
        locator_or_element = await wait_for_locator_or_element(
            page=page,
            engine=engine,
            selector=selector,
            timeout=timeout,
        )

        # Check if empty (if requested)
        if check_empty:
            is_empty = await check_if_element_empty(
                page=page,
                engine=engine,
                locator_or_element=locator_or_element,
            )
            if not is_empty:
                current_value = await get_input_value(
                    page=page,
                    engine=engine,
                    locator_or_element=locator_or_element,
                )
                log.debug(
                    lambda: f"Textarea already has content, skipping: "
                    f'"{current_value[:30]}..."'
                )
                return FillResult(
                    filled=False,
                    verified=False,
                    skipped=True,
                    actual_value=current_value,
                )

        # Scroll into view (if requested and needed)
        if scroll_into_view:
            await scroll_into_view_if_needed(
                page=page,
                engine=engine,
                wait_fn=wait_fn,
                log=log,
                locator_or_element=locator_or_element,
                behavior="smooth",
            )

        # Click the element
        click_result = await click_element(
            page=page,
            engine=engine,
            log=log,
            locator_or_element=locator_or_element,
            no_auto_scroll=not scroll_into_view,
        )
        if not click_result.clicked:
            return FillResult(filled=False, verified=False, skipped=False)

        # Fill the text with verification
        fill_result = await perform_fill(
            page=page,
            engine=engine,
            locator_or_element=locator_or_element,
            text=text,
            simulate_typing=simulate_typing,
            verify=verify,
            verify_fn=verify_fn,
            verification_timeout=verification_timeout,
            log=log,
        )

        if not fill_result.filled:
            return FillResult(filled=False, verified=False, skipped=False)

        log.debug(lambda: f'Filled textarea with text: "{text[:50]}..."')

        if fill_result.verified:
            log.debug(lambda: "Fill verification passed")
        else:
            log.debug(
                lambda: f'Fill verification failed: expected "{text}", '
                f'got "{fill_result.actual_value}"'
            )

        return FillResult(
            filled=True,
            verified=fill_result.verified,
            skipped=False,
            actual_value=fill_result.actual_value,
        )

    except Exception as error:
        if is_navigation_error(error):
            print("Navigation detected during fill_text_area, recovering gracefully")
            return FillResult(filled=False, verified=False, skipped=False)
        raise
