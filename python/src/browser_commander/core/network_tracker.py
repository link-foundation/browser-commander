"""NetworkTracker - Track all HTTP requests and wait for network idle.

This module monitors all network requests on a page and provides
methods to wait until all requests are complete (network idle).
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, Callable

from browser_commander.core.constants import TIMING
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger


class NetworkTracker:
    """Track network requests and detect network idle state."""

    def __init__(
        self,
        page: Any,
        engine: EngineType,
        log: Logger,
        idle_timeout: int = 500,
        request_timeout: int = 30000,
    ) -> None:
        """Initialize NetworkTracker.

        Args:
            page: Playwright page or Selenium WebDriver
            engine: Engine type
            log: Logger instance
            idle_timeout: Time to wait after last request completes (ms)
            request_timeout: Maximum time to wait for a single request (ms)
        """
        self.page = page
        self.engine = engine
        self.log = log
        self.idle_timeout = idle_timeout
        self.request_timeout = request_timeout

        self._pending_requests: dict[str, Any] = {}
        self._request_start_times: dict[str, float] = {}
        self._listeners: dict[str, list[Callable]] = {
            "on_request_start": [],
            "on_request_end": [],
            "on_network_idle": [],
        }
        self._is_tracking = False
        self._idle_timer: asyncio.TimerHandle | None = None
        self._navigation_id = 0

    def _get_request_key(self, request: Any) -> str:
        """Get unique request key."""
        if self.engine == "playwright":
            url = request.url
            method = request.method
        else:
            # For Selenium, we don't have direct request access
            url = str(request)
            method = "GET"
        return f"{method}:{url}"

    def _on_request(self, request: Any) -> None:
        """Handle request start."""
        key = self._get_request_key(request)

        url = request.url if self.engine == "playwright" else str(request)

        # Ignore data URLs and blob URLs
        if url.startswith("data:") or url.startswith("blob:"):
            return

        self._pending_requests[key] = request
        self._request_start_times[key] = time.time() * 1000

        # Clear idle timer since we have a new request
        if self._idle_timer:
            self._idle_timer.cancel()
            self._idle_timer = None

        self.log.debug(
            lambda: f"Request started: {url[:80]}... (pending: {len(self._pending_requests)})"
        )

        # Notify listeners
        for fn in self._listeners["on_request_start"]:
            fn({"url": url, "pending_count": len(self._pending_requests)})

    def _on_request_end(self, request: Any) -> None:
        """Handle request completion (success or failure)."""
        key = self._get_request_key(request)

        if key not in self._pending_requests:
            return

        url = request.url if self.engine == "playwright" else str(request)

        del self._pending_requests[key]
        if key in self._request_start_times:
            del self._request_start_times[key]

        self.log.debug(
            lambda: f"Request ended: {url[:80]}... (pending: {len(self._pending_requests)})"
        )

        # Notify listeners
        for fn in self._listeners["on_request_end"]:
            fn({"url": url, "pending_count": len(self._pending_requests)})

        # Check if we're now idle
        self._check_idle()

    def _check_idle(self) -> None:
        """Check if network is idle and trigger idle event."""
        if len(self._pending_requests) == 0 and not self._idle_timer:
            # Start idle timer (we can't use asyncio timer handle here directly)
            # For now, idle detection will be handled in wait_for_network_idle
            self.log.debug(lambda: "Network idle detected")
            for fn in self._listeners["on_network_idle"]:
                fn()

    def start_tracking(self) -> None:
        """Start tracking network requests."""
        if self._is_tracking:
            return

        self._is_tracking = True
        self._navigation_id += 1

        # Clear any existing state
        self._pending_requests.clear()
        self._request_start_times.clear()

        if self.engine == "playwright":
            # Setup Playwright event listeners
            self.page.on("request", self._on_request)
            self.page.on("requestfinished", self._on_request_end)
            self.page.on("requestfailed", self._on_request_end)

        self.log.debug(lambda: "Network tracking started")

    def stop_tracking(self) -> None:
        """Stop tracking network requests."""
        if not self._is_tracking:
            return

        self._is_tracking = False

        if self.engine == "playwright":
            # Remove Playwright event listeners
            self.page.remove_listener("request", self._on_request)
            self.page.remove_listener("requestfinished", self._on_request_end)
            self.page.remove_listener("requestfailed", self._on_request_end)

        # Clear state
        self._pending_requests.clear()
        self._request_start_times.clear()

        self.log.debug(lambda: "Network tracking stopped")

    async def wait_for_network_idle(
        self,
        timeout: int = TIMING["NETWORK_IDLE_TIMEOUT"],
        idle_time: int | None = None,
    ) -> bool:
        """Wait for network to become idle.

        Args:
            timeout: Maximum time to wait (ms)
            idle_time: Time network must be idle (ms), defaults to idle_timeout

        Returns:
            True if idle, False if timeout
        """
        if idle_time is None:
            idle_time = self.idle_timeout

        start_time = time.time() * 1000
        current_nav_id = self._navigation_id

        # If already idle, wait for idle time
        if len(self._pending_requests) == 0:
            await asyncio.sleep(idle_time / 1000)
            if (
                len(self._pending_requests) == 0
                and self._navigation_id == current_nav_id
            ):
                return True

        # Poll until idle or timeout
        while True:
            elapsed = time.time() * 1000 - start_time
            if elapsed >= timeout:
                self.log.debug(
                    lambda: f"Network idle timeout after {timeout}ms "
                    f"({len(self._pending_requests)} pending)"
                )
                return False

            # Check for navigation change
            if self._navigation_id != current_nav_id:
                return False

            # Check for timed out requests
            now = time.time() * 1000
            for key, start in list(self._request_start_times.items()):
                if now - start > self.request_timeout:
                    self.log.debug(lambda _k=key: f"Request timed out, removing: {_k}")
                    if key in self._pending_requests:
                        del self._pending_requests[key]
                    del self._request_start_times[key]

            # Check if idle
            if len(self._pending_requests) == 0:
                await asyncio.sleep(idle_time / 1000)
                if (
                    len(self._pending_requests) == 0
                    and self._navigation_id == current_nav_id
                ):
                    return True

            await asyncio.sleep(0.1)  # 100ms check interval

    def get_pending_count(self) -> int:
        """Get current pending request count."""
        return len(self._pending_requests)

    def get_pending_urls(self) -> list[str]:
        """Get list of pending request URLs."""
        urls = []
        for _key, req in self._pending_requests.items():
            if self.engine == "playwright":
                urls.append(req.url)
            else:
                urls.append(str(req))
        return urls

    def on(self, event: str, callback: Callable) -> None:
        """Add event listener."""
        if event in self._listeners:
            self._listeners[event].append(callback)

    def off(self, event: str, callback: Callable) -> None:
        """Remove event listener."""
        if event in self._listeners and callback in self._listeners[event]:
            self._listeners[event].remove(callback)

    def reset(self) -> None:
        """Reset tracking (clear all pending requests).

        Called on navigation to start fresh.
        """
        self._navigation_id += 1
        self._pending_requests.clear()
        self._request_start_times.clear()
        self.log.debug(lambda: "Network tracker reset")


def create_network_tracker(
    page: Any,
    engine: EngineType,
    log: Logger,
    idle_timeout: int = 500,
    request_timeout: int = 30000,
) -> NetworkTracker:
    """Create a NetworkTracker instance for a page.

    Args:
        page: Playwright page or Selenium WebDriver
        engine: Engine type
        log: Logger instance
        idle_timeout: Time to wait after last request completes (ms)
        request_timeout: Maximum time to wait for a single request (ms)

    Returns:
        NetworkTracker instance
    """
    return NetworkTracker(
        page=page,
        engine=engine,
        log=log,
        idle_timeout=idle_timeout,
        request_timeout=request_timeout,
    )
