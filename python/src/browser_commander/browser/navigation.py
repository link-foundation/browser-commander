"""Navigation-related browser operations.

This module provides navigation functions that can work with or without
the NavigationManager for backwards compatibility.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from re import Pattern
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_safety import is_navigation_error
from browser_commander.core.page_trigger_manager import is_action_stopped_error


@dataclass
class NavigationVerificationResult:
    """Result of navigation verification."""

    verified: bool
    actual_url: str
    reason: str
    navigation_error: bool = False
    attempts: int = 0


@dataclass
class GotoResult:
    """Result of goto operation."""

    navigated: bool
    verified: bool
    actual_url: str = ""
    reason: str = ""


@dataclass
class WaitAfterActionResult:
    """Result of wait_after_action operation."""

    navigated: bool
    ready: bool


async def default_navigation_verification(
    page: Any,
    expected_url: str | Pattern | None = None,
    start_url: str | None = None,
) -> NavigationVerificationResult:
    """Default verification function for navigation operations.

    Verifies that navigation completed by checking:
    - URL matches expected pattern (if provided)
    - Page is in a ready state

    Args:
        page: Browser page object
        expected_url: Expected URL or URL pattern (optional)
        start_url: URL before navigation

    Returns:
        NavigationVerificationResult with verification status
    """
    try:
        # Get current URL
        if hasattr(page, "url"):
            actual_url = page.url() if callable(page.url) else page.url
        elif hasattr(page, "current_url"):
            actual_url = page.current_url
        else:
            actual_url = ""

        # If expected URL is provided, verify it matches
        if expected_url:
            # Check for exact match
            if actual_url == expected_url:
                return NavigationVerificationResult(
                    verified=True,
                    actual_url=actual_url,
                    reason="exact URL match",
                )

            # Check if expected URL is contained in actual URL (for patterns)
            if isinstance(expected_url, str) and (
                expected_url in actual_url or actual_url.startswith(expected_url)
            ):
                return NavigationVerificationResult(
                    verified=True,
                    actual_url=actual_url,
                    reason="URL pattern match",
                )

            # Check if it's a regex pattern
            if isinstance(expected_url, Pattern) and expected_url.search(actual_url):
                return NavigationVerificationResult(
                    verified=True,
                    actual_url=actual_url,
                    reason="URL regex match",
                )

            return NavigationVerificationResult(
                verified=False,
                actual_url=actual_url,
                reason=f'URL mismatch: expected "{expected_url}", got "{actual_url}"',
            )

        # No expected URL - just verify URL changed from start
        if start_url and actual_url != start_url:
            return NavigationVerificationResult(
                verified=True,
                actual_url=actual_url,
                reason="URL changed from start",
            )

        # If no start URL and no expected URL, assume success
        return NavigationVerificationResult(
            verified=True,
            actual_url=actual_url,
            reason="navigation completed",
        )

    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            return NavigationVerificationResult(
                verified=False,
                actual_url="",
                reason="error during verification",
                navigation_error=True,
            )
        raise


async def verify_navigation(
    page: Any,
    expected_url: str | Pattern | None = None,
    start_url: str | None = None,
    verify_fn: Callable | None = None,
    timeout: int | None = None,
    retry_interval: int | None = None,
    log: Logger | None = None,
) -> NavigationVerificationResult:
    """Verify navigation operation with retry logic.

    Args:
        page: Browser page object
        expected_url: Expected URL (optional)
        start_url: URL before navigation
        verify_fn: Custom verification function (optional)
        timeout: Verification timeout in ms (default: TIMING.VERIFICATION_TIMEOUT)
        retry_interval: Interval between retries
            (default: TIMING.VERIFICATION_RETRY_INTERVAL)
        log: Logger instance

    Returns:
        NavigationVerificationResult with verification status and attempts
    """
    if timeout is None:
        timeout = TIMING.get("VERIFICATION_TIMEOUT", 5000)
    if retry_interval is None:
        retry_interval = TIMING.get("VERIFICATION_RETRY_INTERVAL", 100)
    if verify_fn is None:
        verify_fn = default_navigation_verification

    start_time = time.time()
    attempts = 0
    last_result = NavigationVerificationResult(
        verified=False,
        actual_url="",
        reason="",
    )

    timeout_seconds = timeout / 1000

    while time.time() - start_time < timeout_seconds:
        attempts += 1
        last_result = await verify_fn(page, expected_url, start_url)

        if last_result.verified:
            if log:
                log.debug(
                    lambda _a=attempts,
                    _r=last_result: f"Navigation verification succeeded after "
                    f"{_a} attempt(s): {_r.reason}"
                )
            return NavigationVerificationResult(
                verified=last_result.verified,
                actual_url=last_result.actual_url,
                reason=last_result.reason,
                attempts=attempts,
            )

        if last_result.navigation_error:
            if log:
                log.debug(lambda: "Navigation/stop detected during verification")
            return NavigationVerificationResult(
                verified=last_result.verified,
                actual_url=last_result.actual_url,
                reason=last_result.reason,
                navigation_error=True,
                attempts=attempts,
            )

        # Wait before next retry
        await asyncio.sleep(retry_interval / 1000)

    if log:
        log.debug(
            lambda: f"Navigation verification failed after {attempts} "
            f"attempts: {last_result.reason}"
        )

    return NavigationVerificationResult(
        verified=last_result.verified,
        actual_url=last_result.actual_url,
        reason=last_result.reason,
        attempts=attempts,
    )


async def wait_for_url_stabilization(
    page: Any,
    log: Logger,
    wait_fn: Callable[[int, str], Any],
    navigation_manager: Any | None = None,
    stable_checks: int = 3,
    check_interval: int = 1000,
    timeout: int = 30000,
    reason: str = "URL stabilization",
) -> bool:
    """Wait for URL to stabilize (no redirects happening).

    This is a legacy polling-based approach for backwards compatibility.
    When navigation_manager is available, use wait_for_page_ready instead.

    Args:
        page: Browser page object
        log: Logger instance
        wait_fn: Wait function (ms, reason) -> None
        navigation_manager: NavigationManager instance (optional)
        stable_checks: Number of consecutive stable checks required (default: 3)
        check_interval: Interval between stability checks in ms (default: 1000)
        timeout: Maximum time to wait for stabilization in ms (default: 30000)
        reason: Reason for stabilization (for logging)

    Returns:
        True if stabilized, False if timeout
    """
    # If NavigationManager is available, delegate to it
    if navigation_manager:
        return await navigation_manager.wait_for_page_ready(timeout, reason)

    # Legacy polling-based approach
    log.debug(lambda: f"Waiting for URL to stabilize ({reason})...")
    stable_count = 0

    # Get current URL
    if hasattr(page, "url"):
        last_url = page.url() if callable(page.url) else page.url
    elif hasattr(page, "current_url"):
        last_url = page.current_url
    else:
        last_url = ""

    start_time = time.time()
    timeout_seconds = timeout / 1000

    while stable_count < stable_checks:
        # Check timeout
        if time.time() - start_time > timeout_seconds:
            log.debug(lambda: f"URL stabilization timeout after {timeout}ms ({reason})")
            return False

        await wait_fn(check_interval, "checking URL stability")

        # Get current URL
        if hasattr(page, "url"):
            current_url = page.url() if callable(page.url) else page.url
        elif hasattr(page, "current_url"):
            current_url = page.current_url
        else:
            current_url = ""

        if current_url == last_url:
            stable_count += 1
            log.debug(
                lambda _sc=stable_count,
                _cu=current_url: f"URL stable for {_sc}/{stable_checks} checks: {_cu}"
            )
        else:
            stable_count = 0
            last_url = current_url
            log.debug(
                lambda _cu=current_url: f"URL changed to: {_cu}, resetting stability counter"
            )

    log.debug(lambda: f"URL stabilized ({reason})")
    return True


async def goto(
    page: Any,
    url: str,
    wait_for_url_stabilization_fn: Callable | None = None,
    navigation_manager: Any | None = None,
    log: Logger | None = None,
    wait_until: str = "domcontentloaded",
    wait_for_stable_url_before: bool = True,
    wait_for_stable_url_after: bool = True,
    wait_for_network_idle: bool = True,
    stable_checks: int = 3,
    check_interval: int = 1000,
    timeout: int = 240000,
    verify: bool = True,
    verify_fn: Callable | None = None,
    verification_timeout: int | None = None,
) -> GotoResult:
    """Navigate to URL with full wait for page ready.

    Args:
        page: Browser page object
        url: URL to navigate to
        wait_for_url_stabilization_fn: URL stabilization function (legacy)
        navigation_manager: NavigationManager instance (preferred)
        log: Logger instance (optional)
        wait_until: Wait until condition (default: 'domcontentloaded')
        wait_for_stable_url_before: Wait for URL to stabilize BEFORE navigation
        wait_for_stable_url_after: Wait for URL to stabilize AFTER navigation
        wait_for_network_idle: Wait for all network requests to complete
        stable_checks: Number of consecutive stable checks required
        check_interval: Interval between stability checks in ms
        timeout: Navigation timeout in ms (default: 240000)
        verify: Whether to verify the navigation (default: True)
        verify_fn: Custom verification function (optional)
        verification_timeout: Verification timeout in ms

    Returns:
        GotoResult with navigation and verification status
    """
    if not url:
        raise ValueError("url is required")

    if verification_timeout is None:
        verification_timeout = TIMING.get("VERIFICATION_TIMEOUT", 5000)

    # Create a no-op logger if none provided
    class NoOpLogger:
        def debug(self, _: Callable[[], str]) -> None:
            pass

    if log is None:
        log = NoOpLogger()  # type: ignore

    # Get start URL
    if hasattr(page, "url"):
        start_url = page.url() if callable(page.url) else page.url
    elif hasattr(page, "current_url"):
        start_url = page.current_url
    else:
        start_url = ""

    # If NavigationManager is available, use it for full navigation handling
    if navigation_manager:
        try:
            navigated = await navigation_manager.navigate(url, wait_until, timeout)

            # Verify navigation if requested
            if verify and navigated:
                verification_result = await verify_navigation(
                    page=page,
                    expected_url=url,
                    start_url=start_url,
                    verify_fn=verify_fn,
                    timeout=verification_timeout,
                    log=log,
                )

                return GotoResult(
                    navigated=True,
                    verified=verification_result.verified,
                    actual_url=verification_result.actual_url,
                    reason=verification_result.reason,
                )

            # Get current URL for result
            if hasattr(page, "url"):
                current_url = page.url() if callable(page.url) else page.url
            elif hasattr(page, "current_url"):
                current_url = page.current_url
            else:
                current_url = ""

            return GotoResult(
                navigated=navigated,
                verified=navigated,
                actual_url=current_url,
            )

        except Exception as error:
            if is_navigation_error(error) or is_action_stopped_error(error):
                # Navigation was stopped by page trigger or navigation error
                return GotoResult(
                    navigated=False,
                    verified=False,
                    reason="navigation stopped/interrupted",
                )
            raise

    # Legacy approach without NavigationManager
    try:
        # Wait for URL to stabilize BEFORE navigation
        if wait_for_stable_url_before and wait_for_url_stabilization_fn:
            await wait_for_url_stabilization_fn(
                stable_checks=stable_checks,
                check_interval=check_interval,
                reason="before navigation",
            )

        # Navigate to the URL
        if hasattr(page, "goto"):
            # Playwright
            await page.goto(url, wait_until=wait_until, timeout=timeout)
        elif hasattr(page, "get"):
            # Selenium
            page.get(url)
        else:
            raise ValueError("Unknown page type - cannot navigate")

        # Wait for URL to stabilize AFTER navigation
        if wait_for_stable_url_after and wait_for_url_stabilization_fn:
            await wait_for_url_stabilization_fn(
                stable_checks=stable_checks,
                check_interval=check_interval,
                reason="after navigation",
            )

        # Verify navigation if requested
        if verify:
            verification_result = await verify_navigation(
                page=page,
                expected_url=url,
                start_url=start_url,
                verify_fn=verify_fn,
                timeout=verification_timeout,
                log=log,
            )

            return GotoResult(
                navigated=True,
                verified=verification_result.verified,
                actual_url=verification_result.actual_url,
                reason=verification_result.reason,
            )

        # Get current URL for result
        if hasattr(page, "url"):
            current_url = page.url() if callable(page.url) else page.url
        elif hasattr(page, "current_url"):
            current_url = page.current_url
        else:
            current_url = ""

        return GotoResult(
            navigated=True,
            verified=True,
            actual_url=current_url,
        )

    except Exception as error:
        if is_navigation_error(error) or is_action_stopped_error(error):
            print("Navigation was interrupted/stopped, recovering gracefully")
            return GotoResult(
                navigated=False,
                verified=False,
                reason="navigation interrupted/stopped",
            )
        raise


async def wait_for_navigation(
    page: Any,
    navigation_manager: Any | None = None,
    timeout: int | None = None,
) -> bool:
    """Wait for navigation to complete.

    Args:
        page: Browser page object
        navigation_manager: NavigationManager instance (optional)
        timeout: Timeout in ms

    Returns:
        True if navigation completed, False on error
    """
    # If NavigationManager is available, use it
    if navigation_manager:
        return await navigation_manager.wait_for_navigation(timeout)

    # Legacy approach
    try:
        if hasattr(page, "wait_for_load_state"):
            # Playwright
            if timeout:
                await page.wait_for_load_state("load", timeout=timeout)
            else:
                await page.wait_for_load_state("load")
        # Selenium doesn't have wait_for_navigation, so just return True
        return True
    except Exception as error:
        if is_navigation_error(error):
            print("wait_for_navigation was interrupted, continuing gracefully")
            return False
        raise


async def wait_for_page_ready(
    page: Any,
    navigation_manager: Any | None = None,
    network_tracker: Any | None = None,
    log: Logger | None = None,
    wait_fn: Callable[[int, str], Any] | None = None,
    timeout: int = 30000,
    reason: str = "page ready",
) -> bool:
    """Wait for page to be fully ready (DOM loaded + network idle + no redirects).

    This is the recommended method for ensuring page is ready for manipulation.

    Args:
        page: Browser page object
        navigation_manager: NavigationManager instance (required for full functionality)
        network_tracker: NetworkTracker instance (optional)
        log: Logger instance
        wait_fn: Wait function
        timeout: Maximum time to wait (default: 30000ms)
        reason: Reason for waiting (for logging)

    Returns:
        True if ready, False if timeout
    """

    # Create a no-op logger if none provided
    class NoOpLogger:
        def debug(self, _: Callable[[], str]) -> None:
            pass

    if log is None:
        log = NoOpLogger()  # type: ignore

    # If NavigationManager is available, delegate to it
    if navigation_manager:
        return await navigation_manager.wait_for_page_ready(timeout, reason)

    # Fallback: use network tracker directly if available
    if network_tracker:
        log.debug(lambda: f"Waiting for page ready ({reason})...")
        start_time = time.time()

        # Wait for network idle
        network_idle = await network_tracker.wait_for_network_idle(timeout, 2000)

        elapsed = int((time.time() - start_time) * 1000)
        if network_idle:
            log.debug(lambda: f"Page ready after {elapsed}ms ({reason})")
        else:
            log.debug(lambda: f"Page ready timeout after {elapsed}ms ({reason})")

        return network_idle

    # Minimal fallback: just wait a bit for DOM to settle
    log.debug(lambda: f"Waiting for page ready - minimal mode ({reason})...")
    if wait_fn:
        await wait_fn(1000, "page settle time")
    else:
        await asyncio.sleep(1)
    return True


async def wait_after_action(
    page: Any,
    navigation_manager: Any | None = None,
    network_tracker: Any | None = None,
    log: Logger | None = None,
    wait_fn: Callable[[int, str], Any] | None = None,
    navigation_check_delay: int = 500,
    timeout: int = 30000,
    reason: str = "after action",
) -> WaitAfterActionResult:
    """Wait for any ongoing navigation and network requests to complete.

    Use this after actions that might trigger navigation (like clicks).

    Args:
        page: Browser page object
        navigation_manager: NavigationManager instance
        network_tracker: NetworkTracker instance
        log: Logger instance
        wait_fn: Wait function
        navigation_check_delay: Time to wait for potential navigation to start
        timeout: Maximum time to wait (default: 30000ms)
        reason: Reason for waiting (for logging)

    Returns:
        WaitAfterActionResult with navigated and ready flags
    """

    # Create a no-op logger if none provided
    class NoOpLogger:
        def debug(self, _: Callable[[], str]) -> None:
            pass

    if log is None:
        log = NoOpLogger()  # type: ignore

    # Get start URL
    if hasattr(page, "url"):
        start_url = page.url() if callable(page.url) else page.url
    elif hasattr(page, "current_url"):
        start_url = page.current_url
    else:
        start_url = ""

    start_time = time.time()

    log.debug(lambda: f"Waiting after action ({reason})...")

    # Wait briefly for potential navigation to start
    if wait_fn:
        await wait_fn(navigation_check_delay, "checking for navigation")
    else:
        await asyncio.sleep(navigation_check_delay / 1000)

    # Get current URL
    if hasattr(page, "url"):
        current_url = page.url() if callable(page.url) else page.url
    elif hasattr(page, "current_url"):
        current_url = page.current_url
    else:
        current_url = ""

    url_changed = current_url != start_url

    if navigation_manager and navigation_manager.is_navigating():
        log.debug(lambda: "Navigation in progress, waiting for completion...")
        remaining_timeout = timeout - int((time.time() - start_time) * 1000)
        await navigation_manager.wait_for_navigation(remaining_timeout)
        return WaitAfterActionResult(navigated=True, ready=True)

    if url_changed:
        log.debug(lambda: f"URL changed: {start_url} -> {current_url}")

        # Wait for page to be fully ready
        remaining_timeout = timeout - int((time.time() - start_time) * 1000)
        await wait_for_page_ready(
            page=page,
            navigation_manager=navigation_manager,
            network_tracker=network_tracker,
            log=log,
            wait_fn=wait_fn,
            timeout=remaining_timeout,
            reason="after URL change",
        )

        return WaitAfterActionResult(navigated=True, ready=True)

    # No navigation detected, just wait for network idle
    if network_tracker:
        remaining_timeout = max(0, timeout - int((time.time() - start_time) * 1000))
        idle = await network_tracker.wait_for_network_idle(
            timeout=remaining_timeout,
            idle_time=2000,  # Shorter idle time for non-navigation actions
        )
        return WaitAfterActionResult(navigated=False, ready=idle)

    return WaitAfterActionResult(navigated=False, ready=True)
