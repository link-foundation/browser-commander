"""PageTriggerManager - Manage page triggers with stoppable actions.

This module provides the page trigger system for registering URL-based
triggers with actions that can be safely stopped when navigation occurs.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any, Callable

from browser_commander.core.logger import Logger
from browser_commander.core.navigation_manager import NavigationManager


class ActionStoppedError(Exception):
    """Exception raised when an action is stopped due to navigation."""

    pass


def is_action_stopped_error(error: Exception) -> bool:
    """Check if an error is an ActionStoppedError.

    Args:
        error: The exception to check

    Returns:
        True if this is an ActionStoppedError
    """
    return isinstance(error, ActionStoppedError)


def make_url_condition(pattern: str | re.Pattern | Callable) -> Callable[[str], bool]:
    """Create a URL condition from various pattern types.

    Supports:
    - Exact match: 'https://example.com/page'
    - Wildcard: '*checkout*', '/api/*', '*.json'
    - Express-style patterns: '/vacancy/:id', 'https://hh.ru/vacancy/:vacancyId'
    - RegExp: re.compile(r'/product/\\d+')
    - Custom function: lambda url: bool

    Args:
        pattern: URL pattern to match

    Returns:
        Function that checks if URL matches the pattern
    """
    # Already a function
    if callable(pattern):
        return pattern

    # Compiled regex
    if isinstance(pattern, re.Pattern):
        return lambda url: pattern.search(url) is not None

    # String pattern
    if isinstance(pattern, str):
        # Convert wildcard pattern to regex
        if "*" in pattern:
            # Escape special regex chars except *
            escaped = re.escape(pattern).replace(r"\*", ".*")
            regex = re.compile(escaped)
            return lambda url: regex.search(url) is not None

        # Check for Express-style pattern with :param
        if ":" in pattern:
            # Convert :param to regex group
            param_pattern = re.sub(r":(\w+)", r"(?P<\1>[^/]+)", pattern)
            regex = re.compile(param_pattern)
            return lambda url: regex.search(url) is not None

        # Exact match
        return lambda url: url == pattern or url.startswith(pattern)

    msg = f"Invalid pattern type: {type(pattern)}"
    raise ValueError(msg)


def all_conditions(*conditions: Callable[[str], bool]) -> Callable[[str], bool]:
    """Combine conditions with AND logic.

    Args:
        *conditions: URL condition functions

    Returns:
        Function that returns True if all conditions match
    """
    return lambda url: all(cond(url) for cond in conditions)


def any_condition(*conditions: Callable[[str], bool]) -> Callable[[str], bool]:
    """Combine conditions with OR logic.

    Args:
        *conditions: URL condition functions

    Returns:
        Function that returns True if any condition matches
    """
    return lambda url: any(cond(url) for cond in conditions)


def not_condition(condition: Callable[[str], bool]) -> Callable[[str], bool]:
    """Negate a condition.

    Args:
        condition: URL condition function

    Returns:
        Function that returns True if condition doesn't match
    """
    return lambda url: not condition(url)


class ActionContext:
    """Context passed to trigger actions for safe execution."""

    def __init__(
        self,
        url: str,
        trigger_name: str,
        abort_signal: asyncio.Event,
        commander: Any,
    ) -> None:
        """Initialize action context.

        Args:
            url: Current page URL
            trigger_name: Name of the trigger
            abort_signal: Abort signal event
            commander: Browser commander instance
        """
        self.url = url
        self.trigger_name = trigger_name
        self._abort_signal = abort_signal
        self.commander = commander
        self._cleanup_callbacks: list[Callable] = []

    def is_stopped(self) -> bool:
        """Check if action should stop."""
        return self._abort_signal.is_set()

    def check_stopped(self) -> None:
        """Raise ActionStoppedError if action should stop."""
        if self.is_stopped():
            raise ActionStoppedError(f"Action '{self.trigger_name}' was stopped")

    async def wait(self, ms: int) -> None:
        """Safe wait that respects abort signal.

        Args:
            ms: Milliseconds to wait

        Raises:
            ActionStoppedError: If action is stopped during wait
        """
        try:
            await asyncio.wait_for(
                self._abort_signal.wait(),
                timeout=ms / 1000,
            )
            # If we get here, abort was signaled
            raise ActionStoppedError(f"Action '{self.trigger_name}' was stopped")
        except asyncio.TimeoutError:
            # Timeout means wait completed normally
            pass

    async def for_each(
        self,
        items: list[Any],
        fn: Callable[[Any, int], Any],
    ) -> list[Any]:
        """Safe iteration that checks for stop between items.

        Args:
            items: Items to iterate over
            fn: Async function to call for each item (item, index)

        Returns:
            List of results

        Raises:
            ActionStoppedError: If action is stopped during iteration
        """
        results = []
        for i, item in enumerate(items):
            self.check_stopped()
            result = await fn(item, i)
            results.append(result)
        return results

    def on_cleanup(self, callback: Callable) -> None:
        """Register cleanup callback.

        Args:
            callback: Function to call during cleanup
        """
        self._cleanup_callbacks.append(callback)

    async def cleanup(self) -> None:
        """Run all cleanup callbacks."""
        for callback in self._cleanup_callbacks:
            try:
                result = callback()
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass  # Ignore cleanup errors


class PageTriggerManager:
    """Manage page triggers with stoppable actions."""

    def __init__(
        self,
        navigation_manager: NavigationManager,
        log: Logger,
    ) -> None:
        """Initialize PageTriggerManager.

        Args:
            navigation_manager: NavigationManager instance
            log: Logger instance
        """
        self.navigation_manager = navigation_manager
        self.log = log
        self._triggers: list[dict] = []
        self._active_actions: list[ActionContext] = []
        self._commander: Any = None
        self._background_tasks: set[asyncio.Task] = set()

    def initialize(self, commander: Any) -> None:
        """Initialize with commander reference.

        Args:
            commander: Browser commander instance
        """
        self._commander = commander

        # Subscribe to URL changes
        self.navigation_manager.on("on_url_change", self._on_url_change)

    def _on_url_change(self, event: dict) -> None:
        """Handle URL change event."""
        new_url = event["new_url"]

        # Stop all active actions
        for ctx in self._active_actions:
            ctx._abort_signal.set()

        # Check triggers for new URL
        task = asyncio.create_task(self._check_triggers(new_url))
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def _check_triggers(self, url: str) -> None:
        """Check and run matching triggers for URL.

        Args:
            url: Current URL to check
        """
        for trigger in self._triggers:
            condition = trigger["condition"]
            if condition(url):
                await self._run_trigger(trigger, url)

    async def _run_trigger(self, trigger: dict, url: str) -> None:
        """Run a trigger's action.

        Args:
            trigger: Trigger configuration
            url: Current URL
        """
        name = trigger.get("name", "unnamed")
        action = trigger["action"]

        self.log.debug(lambda: f"Running trigger '{name}' for URL: {url}")

        abort_signal = asyncio.Event()
        ctx = ActionContext(
            url=url,
            trigger_name=name,
            abort_signal=abort_signal,
            commander=self._commander,
        )
        self._active_actions.append(ctx)

        try:
            await action(ctx)
        except ActionStoppedError:
            self.log.debug(lambda: f"Trigger '{name}' was stopped")
        except Exception as e:
            self.log.debug(lambda _e=e: f"Trigger '{name}' error: {_e}")
        finally:
            await ctx.cleanup()
            if ctx in self._active_actions:
                self._active_actions.remove(ctx)

    def page_trigger(self, config: dict) -> None:
        """Register a page trigger.

        Args:
            config: Trigger configuration with:
                - condition: URL condition (string, regex, or function)
                - action: Async function to run when condition matches
                - name: Optional trigger name for debugging
        """
        condition = config.get("condition")
        action = config.get("action")
        name = config.get("name", "unnamed")

        if not condition or not action:
            msg = "page_trigger requires 'condition' and 'action'"
            raise ValueError(msg)

        # Convert condition to callable
        if not callable(condition):
            condition = make_url_condition(condition)

        self._triggers.append(
            {
                "condition": condition,
                "action": action,
                "name": name,
            }
        )

    async def destroy(self) -> None:
        """Clean up and stop all actions."""
        # Stop all active actions
        for ctx in self._active_actions:
            ctx._abort_signal.set()
            await ctx.cleanup()

        self._active_actions.clear()
        self._triggers.clear()

        # Unsubscribe from events
        self.navigation_manager.off("on_url_change", self._on_url_change)
