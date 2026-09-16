"""NavigationManager - Monitor URL changes and manage navigation state.

This module provides navigation lifecycle management including:
- URL change detection
- Navigation start/complete events
- Page ready state tracking
- Abort signal management for stoppable actions
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_readiness import ReadinessWaiter
from browser_commander.core.network_tracker import NetworkTracker
from browser_commander.core.readiness import (
    Deadline,
    ReadinessCheck,
    ReadinessResult,
    sleep_within_deadline,
)


class NavigationManager:
    """Manage navigation lifecycle and state."""

    def __init__(
        self,
        page: Any,
        engine: EngineType,
        log: Logger,
        network_tracker: NetworkTracker | None = None,
    ) -> None:
        """Initialize NavigationManager.

        Args:
            page: Playwright page or Selenium WebDriver
            engine: Engine type
            log: Logger instance
            network_tracker: Optional NetworkTracker for network idle detection
        """
        self.page = page
        self.engine = engine
        self.log = log
        self.network_tracker = network_tracker

        self._is_listening = False
        self._is_navigating = False
        self._last_url = ""
        self._abort_controller: asyncio.Event | None = None
        self._page_ready_task: asyncio.Task[ReadinessResult] | None = None
        self._listeners: dict[str, list[Callable]] = {
            "on_navigation_start": [],
            "on_navigation_complete": [],
            "on_url_change": [],
            "on_page_ready": [],
        }
        self._readiness = ReadinessWaiter(
            page=page,
            engine=engine,
            log=log,
            network_tracker=network_tracker,
            get_url=self._get_current_url,
            on_url_sample=self._on_url_sample,
            on_ready=self._on_readiness_satisfied,
            on_not_ready=lambda: self._finish_navigation_tracking(ready=False),
        )

    def configure(
        self,
        redirect_stabilization_time: int | None = None,
    ) -> None:
        """Adjust navigation configuration.

        Args:
            redirect_stabilization_time: URL quiet period required for readiness
        """
        if redirect_stabilization_time is not None:
            self._readiness.redirect_stabilization_time = redirect_stabilization_time

    def start_listening(self) -> None:
        """Start listening for navigation events."""
        if self._is_listening:
            return

        self._is_listening = True
        self._last_url = self._get_current_url()
        self._abort_controller = asyncio.Event()

        if self.engine == "playwright":
            # Setup Playwright navigation listeners
            self.page.on("framenavigated", self._on_frame_navigated)

        self.log.debug(lambda: "Navigation manager started listening")

    def stop_listening(self) -> None:
        """Stop listening for navigation events."""
        if not self._is_listening:
            return

        self._is_listening = False

        if self.engine == "playwright":
            self.page.remove_listener("framenavigated", self._on_frame_navigated)

        self.log.debug(lambda: "Navigation manager stopped listening")

    def _get_current_url(self) -> str:
        """Get current page URL."""
        if self.engine == "playwright":
            return self.page.url
        return self.page.current_url

    def _on_frame_navigated(self, frame: Any) -> None:
        """Handle frame navigation event (Playwright)."""
        # Only care about main frame navigation
        if frame != self.page.main_frame:
            return

        new_url = self._get_current_url()
        if new_url != self._last_url:
            self._on_url_change(new_url)

    def _on_url_change(self, new_url: str) -> None:
        """Handle URL change."""
        old_url = self._last_url
        self._last_url = new_url

        self.log.debug(lambda: f"URL changed: {old_url} -> {new_url}")

        # Signal abort to any running actions
        if self._abort_controller:
            self._abort_controller.set()
            self._abort_controller = asyncio.Event()

        # Set navigating state
        self._is_navigating = True

        # Notify listeners
        for fn in self._listeners["on_url_change"]:
            fn({"old_url": old_url, "new_url": new_url})

        for fn in self._listeners["on_navigation_start"]:
            fn({"url": new_url})

    def is_navigating(self) -> bool:
        """Check if navigation is in progress."""
        return self._is_navigating

    def should_abort(self) -> bool:
        """Check if actions should abort due to navigation."""
        return self._abort_controller is not None and self._abort_controller.is_set()

    def get_abort_signal(self) -> asyncio.Event | None:
        """Get the current abort signal."""
        return self._abort_controller

    async def navigate(
        self,
        url: str,
        wait_until: str = "domcontentloaded",
        timeout: int = TIMING["NAVIGATION_TIMEOUT"],
    ) -> bool:
        """Navigate to URL with full wait handling.

        Args:
            url: URL to navigate to
            wait_until: Wait condition ('load', 'domcontentloaded', 'networkidle')
            timeout: Timeout in milliseconds

        Returns:
            True if navigation completed successfully
        """
        self._is_navigating = True

        try:
            if self.engine == "playwright":
                await self.page.goto(url, wait_until=wait_until, timeout=timeout)
            else:
                self.page.set_page_load_timeout(timeout / 1000)
                self.page.get(url)

            # Wait for page to be ready. A failed wait leaves the navigation
            # closed out but does not emit a ready page.
            ready = await self.wait_for_page_ready(timeout=timeout)
            if not ready:
                self.abandon_navigation("page did not become ready")

            # Notify completion
            for fn in self._listeners["on_navigation_complete"]:
                fn({"url": url})

            return True

        except Exception as e:
            self.abandon_navigation("navigation interrupted")
            self.log.debug(lambda _e=e: f"Navigation error: {_e}")
            raise

    async def wait_for_navigation(
        self,
        timeout: int = TIMING["NAVIGATION_TIMEOUT"],
    ) -> bool:
        """Wait for current navigation to complete.

        Args:
            timeout: Timeout in milliseconds

        Returns:
            True if navigation completed, False on timeout
        """
        if not self._is_navigating:
            return True

        deadline = Deadline(timeout=timeout)

        while self._is_navigating:
            if deadline.expired():
                return False
            await sleep_within_deadline(100, deadline)

        return True

    def _on_url_sample(self, url: str) -> None:
        """Record a URL observed while waiting for readiness.

        Redirects seen mid-wait update the tracked URL but do not restart
        navigation tracking - the wait already owns the budget.
        """
        if url and url != self._last_url:
            self._last_url = url
            self.log.debug(lambda: f"Redirect detected: {url}")

    def _on_readiness_satisfied(self) -> None:
        """Close out navigation and announce readiness, in that order."""
        self._finish_navigation_tracking(ready=True)
        self._emit_page_ready()

    def _finish_navigation_tracking(self, ready: bool = False) -> None:
        """Stop tracking the in-flight navigation.

        This answers only "is a navigation still in flight?". Whether the page
        is usable is a separate question answered by :meth:`_emit_page_ready`;
        conflating the two is what let a failed readiness wait still announce a
        ready page.

        Args:
            ready: Whether the readiness checks were satisfied
        """
        if not self._is_navigating:
            return
        self._is_navigating = False
        if not ready:
            self.log.debug(lambda: "Navigation tracking finished without readiness")

    def _emit_page_ready(self) -> None:
        """Announce that the page is usable. Only readiness may call this."""
        for fn in self._listeners["on_page_ready"]:
            fn({"url": self._get_current_url()})

    def abandon_navigation(self, reason: str) -> None:
        """Give up on the in-flight navigation without claiming readiness.

        Args:
            reason: Why the navigation was abandoned
        """
        self.log.debug(lambda: f"Navigation abandoned: {reason}")
        self._finish_navigation_tracking(ready=False)

    async def wait_for_readiness(
        self,
        timeout: int = TIMING["NAVIGATION_TIMEOUT"],
        reason: str = "page ready",
        checks: Sequence[ReadinessCheck] | None = None,
    ) -> ReadinessResult:
        """Wait for the page to be ready and return the full evidence.

        Concurrent callers join the in-flight wait rather than starting a
        second one, so the budget is never spent twice over.

        Args:
            timeout: Maximum time to wait (ms), shared by every check
            reason: Reason for waiting (for logging)
            checks: Composable readiness checks, defaults to URL + network idle

        Returns:
            The structured readiness result
        """
        if self._page_ready_task and not self._page_ready_task.done():
            self.log.debug(lambda: f"Joining in-flight page ready wait ({reason})")
            return await asyncio.shield(self._page_ready_task)

        self._page_ready_task = asyncio.ensure_future(
            self._readiness.wait_for_ready(
                timeout=timeout,
                reason=reason,
                checks=checks,
            )
        )
        try:
            return await self._page_ready_task
        finally:
            self._page_ready_task = None

    async def wait_for_page_ready(
        self,
        timeout: int = TIMING["NAVIGATION_TIMEOUT"],
        reason: str = "page ready",
    ) -> bool:
        """Wait for page to be fully ready (URL settled + network idle).

        Args:
            timeout: Maximum time to wait (ms)
            reason: Reason for waiting (for logging)

        Returns:
            True only when every readiness check was satisfied
        """
        result = await self.wait_for_readiness(timeout=timeout, reason=reason)
        return result.ready

    def on(self, event: str, callback: Callable) -> None:
        """Add event listener."""
        if event in self._listeners:
            self._listeners[event].append(callback)

    def off(self, event: str, callback: Callable) -> None:
        """Remove event listener."""
        if event in self._listeners and callback in self._listeners[event]:
            self._listeners[event].remove(callback)


def create_navigation_manager(
    page: Any,
    engine: EngineType,
    log: Logger,
    network_tracker: NetworkTracker | None = None,
) -> NavigationManager:
    """Create a NavigationManager instance.

    Args:
        page: Playwright page or Selenium WebDriver
        engine: Engine type
        log: Logger instance
        network_tracker: Optional NetworkTracker for network idle detection

    Returns:
        NavigationManager instance
    """
    return NavigationManager(
        page=page,
        engine=engine,
        log=log,
        network_tracker=network_tracker,
    )
