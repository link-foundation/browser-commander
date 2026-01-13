"""NavigationManager - Monitor URL changes and manage navigation state.

This module provides navigation lifecycle management including:
- URL change detection
- Navigation start/complete events
- Page ready state tracking
- Abort signal management for stoppable actions
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.network_tracker import NetworkTracker


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
        self._listeners: dict[str, list[Callable]] = {
            "on_navigation_start": [],
            "on_navigation_complete": [],
            "on_url_change": [],
            "on_page_ready": [],
        }

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

            # Wait for page to be ready
            await self.wait_for_page_ready(timeout=timeout)

            self._is_navigating = False

            # Notify completion
            for fn in self._listeners["on_navigation_complete"]:
                fn({"url": url})

            return True

        except Exception as e:
            self._is_navigating = False
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

        start_time = time.time() * 1000

        while self._is_navigating:
            if time.time() * 1000 - start_time > timeout:
                return False
            await asyncio.sleep(0.1)

        return True

    async def wait_for_page_ready(
        self,
        timeout: int = TIMING["NAVIGATION_TIMEOUT"],
        reason: str = "page ready",
    ) -> bool:
        """Wait for page to be fully ready (DOM loaded + network idle).

        Args:
            timeout: Maximum time to wait (ms)
            reason: Reason for waiting (for logging)

        Returns:
            True if ready, False if timeout
        """
        self.log.debug(lambda: f"Waiting for page ready ({reason})...")
        start_time = time.time() * 1000

        # Wait for network idle if network tracker available
        if self.network_tracker:
            remaining_timeout = timeout - (time.time() * 1000 - start_time)
            if remaining_timeout > 0:
                network_idle = await self.network_tracker.wait_for_network_idle(
                    timeout=int(remaining_timeout)
                )
                if not network_idle:
                    self.log.debug(
                        lambda: f"Page ready timeout after {timeout}ms ({reason})"
                    )
                    return False

        elapsed = time.time() * 1000 - start_time
        self.log.debug(lambda: f"Page ready after {elapsed:.0f}ms ({reason})")

        self._is_navigating = False

        # Notify listeners
        for fn in self._listeners["on_page_ready"]:
            fn({"url": self._get_current_url()})

        return True

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
