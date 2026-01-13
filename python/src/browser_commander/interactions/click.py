"""Click interactions for browser-commander.

This module provides click functions for both Playwright and Selenium engines.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.core.page_trigger_manager import is_action_stopped_error
from browser_commander.elements.content import log_element_info
from browser_commander.elements.locators import wait_for_locator_or_element
from browser_commander.interactions.scroll import scroll_into_view_if_needed


@dataclass
class ClickVerificationResult:
    """Result of click verification."""

    verified: bool
    reason: str
    navigation_error: bool = False


@dataclass
class ClickResult:
    """Result of click operation."""

    clicked: bool
    verified: bool
    reason: str = ""
    navigated: bool = False


async def default_click_verification(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    pre_click_state: dict | None = None,
    adapter: Any | None = None,
) -> ClickVerificationResult:
    """Default verification function for click operations.

    Verifies that the click had an effect by checking for common patterns:
    - Element state changes (disabled, aria-pressed, etc.)
    - Element class changes
    - Element visibility changes

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        locator_or_element: Element that was clicked
        pre_click_state: State captured before click (optional)
        adapter: Engine adapter (optional)

    Returns:
        ClickVerificationResult
    """
    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        # Get current element state
        get_state_js = """
        (el) => ({
            disabled: el.disabled,
            ariaPressed: el.getAttribute('aria-pressed'),
            ariaExpanded: el.getAttribute('aria-expanded'),
            ariaSelected: el.getAttribute('aria-selected'),
            checked: el.checked,
            className: el.className,
            isConnected: el.isConnected,
        })
        """

        post_click_state = await adapter.evaluate_on_element(
            locator_or_element,
            get_state_js,
        )

        # If we have pre-click state, check for changes
        if pre_click_state and len(pre_click_state) > 0:
            if pre_click_state.get("ariaPressed") != post_click_state.get(
                "ariaPressed"
            ):
                return ClickVerificationResult(
                    verified=True, reason="aria-pressed changed"
                )
            if pre_click_state.get("ariaExpanded") != post_click_state.get(
                "ariaExpanded"
            ):
                return ClickVerificationResult(
                    verified=True, reason="aria-expanded changed"
                )
            if pre_click_state.get("ariaSelected") != post_click_state.get(
                "ariaSelected"
            ):
                return ClickVerificationResult(
                    verified=True, reason="aria-selected changed"
                )
            if pre_click_state.get("checked") != post_click_state.get("checked"):
                return ClickVerificationResult(
                    verified=True, reason="checked state changed"
                )
            if pre_click_state.get("className") != post_click_state.get("className"):
                return ClickVerificationResult(
                    verified=True, reason="className changed"
                )

        # If element is still connected and not disabled, assume click worked
        if post_click_state.get("isConnected"):
            return ClickVerificationResult(
                verified=True,
                reason="element still connected (assumed success)",
            )

        # Element was removed from DOM - likely click triggered UI change
        return ClickVerificationResult(
            verified=True, reason="element removed from DOM (UI updated)"
        )

    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            return ClickVerificationResult(
                verified=True,
                reason="navigation detected (expected for navigation clicks)",
                navigation_error=True,
            )
        raise


async def capture_pre_click_state(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    adapter: Any | None = None,
) -> dict:
    """Capture element state before click for verification.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element to capture state from
        adapter: Engine adapter (optional)

    Returns:
        Pre-click state dict
    """
    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        get_state_js = """
        (el) => ({
            disabled: el.disabled,
            ariaPressed: el.getAttribute('aria-pressed'),
            ariaExpanded: el.getAttribute('aria-expanded'),
            ariaSelected: el.getAttribute('aria-selected'),
            checked: el.checked,
            className: el.className,
            isConnected: el.isConnected,
        })
        """

        return await adapter.evaluate_on_element(locator_or_element, get_state_js)
    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            return {}
        raise


async def verify_click(
    page: Any,
    engine: EngineType,
    locator_or_element: Any,
    pre_click_state: dict | None = None,
    verify_fn: Callable | None = None,
    log: Logger | None = None,
) -> ClickVerificationResult:
    """Verify click operation.

    Args:
        page: Browser page object
        engine: Engine type
        locator_or_element: Element that was clicked
        pre_click_state: State captured before click
        verify_fn: Custom verification function (optional)
        log: Logger instance

    Returns:
        ClickVerificationResult
    """
    if verify_fn is None:
        verify_fn = default_click_verification
    if pre_click_state is None:
        pre_click_state = {}

    result = await verify_fn(
        page=page,
        engine=engine,
        locator_or_element=locator_or_element,
        pre_click_state=pre_click_state,
    )

    if log:
        if result.verified:
            log.debug(lambda: f"Click verification passed: {result.reason}")
        else:
            log.debug(
                lambda: f"Click verification uncertain: {result.reason or 'unknown'}"
            )

    return result


async def click_element(
    page: Any,
    engine: EngineType,
    log: Logger,
    locator_or_element: Any,
    no_auto_scroll: bool = False,
    verify: bool = True,
    verify_fn: Callable | None = None,
    adapter: Any | None = None,
) -> ClickResult:
    """Click an element (low-level).

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        log: Logger instance
        locator_or_element: Element or locator to click
        no_auto_scroll: Prevent Playwright's automatic scrolling (default: False)
        verify: Whether to verify the click operation (default: True)
        verify_fn: Custom verification function (optional)
        adapter: Engine adapter (optional)

    Returns:
        ClickResult
    """
    if not locator_or_element:
        raise ValueError("locator_or_element is required")

    try:
        if adapter is None:
            adapter = create_engine_adapter(page, engine)

        # Capture pre-click state for verification
        pre_click_state = {}
        if verify:
            pre_click_state = await capture_pre_click_state(
                page=page,
                engine=engine,
                locator_or_element=locator_or_element,
                adapter=adapter,
            )

        # Click with appropriate options
        force_click = False
        if engine == "playwright" and no_auto_scroll:
            force_click = True
            log.debug(lambda: "Clicking with no_auto_scroll (force: True)")

        await adapter.click(locator_or_element, force=force_click)

        # Verify click if requested
        if verify:
            verification_result = await verify_click(
                page=page,
                engine=engine,
                locator_or_element=locator_or_element,
                pre_click_state=pre_click_state,
                verify_fn=verify_fn,
                log=log,
            )

            return ClickResult(
                clicked=True,
                verified=verification_result.verified,
                reason=verification_result.reason,
            )

        return ClickResult(clicked=True, verified=True)

    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            print("Navigation/stop detected during click, recovering gracefully")
            return ClickResult(
                clicked=False,
                verified=True,
                reason="navigation during click",
            )
        raise


async def _detect_navigation(
    page: Any,
    navigation_manager: Any | None,
    start_url: str,
    log: Logger,
) -> tuple[bool, str]:
    """Detect if a click caused navigation by checking URL change or navigation state.

    Args:
        page: Browser page object
        navigation_manager: NavigationManager instance (optional)
        start_url: URL before click
        log: Logger instance

    Returns:
        Tuple of (navigated, new_url)
    """
    # Get current URL
    if hasattr(page, "url"):
        current_url = page.url() if callable(page.url) else page.url
    elif hasattr(page, "current_url"):
        current_url = page.current_url
    else:
        current_url = ""

    url_changed = current_url != start_url

    if navigation_manager and navigation_manager.is_navigating():
        log.debug(lambda: "Navigation detected via NavigationManager")
        return True, current_url

    if url_changed:
        log.debug(lambda: f"URL changed: {start_url} -> {current_url}")
        return True, current_url

    return False, current_url


async def click_button(
    page: Any,
    engine: EngineType,
    wait_fn: Callable[[int, str], Any],
    log: Logger,
    selector: str | Any,
    verbose: bool = False,
    navigation_manager: Any | None = None,
    network_tracker: Any | None = None,
    scroll_into_view: bool = True,
    wait_after_scroll: int | None = None,
    smooth_scroll: bool = True,
    wait_after_click: int = 1000,
    wait_for_navigation: bool = True,
    navigation_check_delay: int = 500,
    timeout: int | None = None,
    verify: bool = True,
    verify_fn: Callable | None = None,
) -> ClickResult:
    """Click a button or element (high-level with scrolling and waits).

    Now navigation-aware - automatically waits for page ready after
    navigation-causing clicks.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        wait_fn: Wait function (ms, reason) -> Any
        log: Logger instance
        selector: CSS selector, ElementHandle, or Playwright Locator
        verbose: Enable verbose logging
        navigation_manager: NavigationManager instance (optional)
        network_tracker: NetworkTracker instance (optional)
        scroll_into_view: Scroll into view (default: True)
        wait_after_scroll: Wait time after scroll in ms
        smooth_scroll: Use smooth scroll animation (default: True)
        wait_after_click: Wait time after click in ms (default: 1000)
        wait_for_navigation: Wait for navigation to complete if click causes navigation
        navigation_check_delay: Time to check if navigation started (default: 500ms)
        timeout: Timeout in ms
        verify: Whether to verify the click operation (default: True)
        verify_fn: Custom verification function (optional)

    Returns:
        ClickResult
    """
    if timeout is None:
        timeout = TIMING.get("DEFAULT_TIMEOUT", 5000)
    if wait_after_scroll is None:
        wait_after_scroll = TIMING.get("DEFAULT_WAIT_AFTER_SCROLL", 300)

    if not selector:
        raise ValueError("selector is required")

    # Record URL before click for navigation detection
    if hasattr(page, "url"):
        start_url = page.url() if callable(page.url) else page.url
    elif hasattr(page, "current_url"):
        start_url = page.current_url
    else:
        start_url = ""

    try:
        # Step 1: Get locator/element and wait for it to be visible
        locator_or_element = await wait_for_locator_or_element(
            page=page,
            engine=engine,
            selector=selector,
            timeout=timeout,
        )

        # Log element info if verbose
        if verbose:
            await log_element_info(
                page=page,
                engine=engine,
                log=log,
                locator_or_element=locator_or_element,
            )

        # Step 2: Scroll into view if needed
        if scroll_into_view:
            behavior = "smooth" if smooth_scroll else "instant"
            scroll_result = await scroll_into_view_if_needed(
                page=page,
                engine=engine,
                wait_fn=wait_fn,
                log=log,
                locator_or_element=locator_or_element,
                behavior=behavior,
                wait_after_scroll=wait_after_scroll,
                verify=False,  # Don't verify scroll here, we verify overall click
            )

            # Check if scroll was aborted due to navigation/stop
            if not scroll_result.skipped and not scroll_result.scrolled:
                return ClickResult(
                    clicked=False,
                    navigated=True,
                    verified=True,
                    reason="navigation during scroll",
                )
        else:
            log.debug(lambda: "Skipping scroll (scroll_into_view: False)")

        # Step 3: Execute click operation
        log.debug(lambda: "About to click element")

        click_result = await click_element(
            page=page,
            engine=engine,
            log=log,
            locator_or_element=locator_or_element,
            no_auto_scroll=not scroll_into_view,
            verify=verify,
            verify_fn=verify_fn,
        )

        if not click_result.clicked:
            # Navigation/stop occurred during click itself
            return ClickResult(
                clicked=False,
                navigated=True,
                verified=True,
                reason="navigation during click",
            )

        log.debug(lambda: "Click completed")

        # Step 4: Handle navigation detection and waiting
        if wait_for_navigation:
            # Wait briefly for navigation to potentially start
            await wait_fn(navigation_check_delay, "checking for navigation after click")

            # Detect if navigation occurred
            navigated, new_url = await _detect_navigation(
                page=page,
                navigation_manager=navigation_manager,
                start_url=start_url,
                log=log,
            )

            if navigated:
                log.debug(lambda: f"Click triggered navigation to: {new_url}")

                # Wait for page to be fully ready
                if navigation_manager:
                    await navigation_manager.wait_for_page_ready(
                        120000, "after click navigation"
                    )
                elif network_tracker:
                    await network_tracker.wait_for_network_idle(120000, 30000)
                else:
                    await wait_fn(2000, "page settle after navigation")

                return ClickResult(
                    clicked=True,
                    navigated=True,
                    verified=True,
                    reason="click triggered navigation",
                )

        # No navigation - wait after click if specified
        if wait_after_click > 0:
            await wait_fn(
                wait_after_click, "post-click settling time for modal scroll capture"
            )

        # If we have network tracking, wait for any XHR/fetch to complete
        if network_tracker:
            await network_tracker.wait_for_network_idle(10000, 2000)

        return ClickResult(
            clicked=True,
            navigated=False,
            verified=click_result.verified,
            reason=click_result.reason if click_result.reason else "no navigation",
        )

    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            print("Navigation/stop detected during click_button, recovering gracefully")
            return ClickResult(
                clicked=False,
                navigated=True,
                verified=True,
                reason="navigation/stop error",
            )
        raise
