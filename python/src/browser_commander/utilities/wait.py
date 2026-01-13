"""Wait utilities for browser-commander.

This module provides wait/delay functions for both Playwright and Selenium engines.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from browser_commander.core.engine_adapter import create_engine_adapter
from browser_commander.core.engine_detection import EngineType
from browser_commander.core.logger import Logger
from browser_commander.core.navigation_safety import is_navigation_error


@dataclass
class WaitResult:
    """Result of wait operation."""

    completed: bool
    aborted: bool


@dataclass
class EvaluateResult:
    """Result of safe evaluate operation."""

    success: bool
    value: Any
    navigation_error: bool


async def wait(
    log: Logger,
    ms: int,
    reason: str | None = None,
    abort_signal: asyncio.Event | None = None,
) -> WaitResult:
    """Wait/sleep for a specified time with optional verbose logging.

    Now supports abort signals to interrupt the wait when navigation occurs.

    Args:
        log: Logger instance
        ms: Milliseconds to wait
        reason: Reason for waiting (for verbose logging)
        abort_signal: Optional asyncio.Event to interrupt wait

    Returns:
        WaitResult with completed and aborted flags
    """
    if not ms:
        raise ValueError("ms is required")

    if reason:
        log.debug(lambda: f"Waiting {ms}ms: {reason}")

    # If abort signal provided, use abortable wait
    if abort_signal:
        # Check if already aborted
        if abort_signal.is_set():
            log.debug(
                lambda: f"Wait skipped (already aborted): {reason or 'no reason'}"
            )
            return WaitResult(completed=False, aborted=True)

        try:
            # Wait for either the timeout or the abort signal
            await asyncio.wait_for(
                abort_signal.wait(),
                timeout=ms / 1000,
            )
            # If we get here, abort was signaled
            log.debug(lambda: f"Wait aborted: {reason or 'no reason'}")
            return WaitResult(completed=False, aborted=True)
        except asyncio.TimeoutError:
            # Timeout means wait completed normally
            if reason:
                log.debug(lambda: f"Wait complete ({ms}ms)")
            return WaitResult(completed=True, aborted=False)

    # Standard non-abortable wait (backwards compatible)
    await asyncio.sleep(ms / 1000)

    if reason:
        log.debug(lambda: f"Wait complete ({ms}ms)")

    return WaitResult(completed=True, aborted=False)


async def evaluate(
    page: Any,
    engine: EngineType,
    fn: str,
    args: list | None = None,
    adapter: Any | None = None,
) -> Any:
    """Evaluate JavaScript in page context.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        fn: JavaScript function string to evaluate
        args: Arguments to pass to function (default: [])
        adapter: Engine adapter (optional, will be created if not provided)

    Returns:
        Result of evaluation
    """
    if args is None:
        args = []

    if not fn:
        raise ValueError("fn is required")

    if adapter is None:
        adapter = create_engine_adapter(page, engine)

    return await adapter.evaluate_on_page(fn, args)


async def safe_evaluate(
    page: Any,
    engine: EngineType,
    fn: str,
    args: list | None = None,
    default_value: Any = None,
    operation_name: str = "evaluate",
    silent: bool = False,
) -> EvaluateResult:
    """Safe evaluate that catches navigation errors and returns default value.

    Args:
        page: Browser page object
        engine: Engine type ('playwright' or 'selenium')
        fn: JavaScript function string to evaluate
        args: Arguments to pass to function (default: [])
        default_value: Value to return on navigation error (default: None)
        operation_name: Name for logging (default: 'evaluate')
        silent: Don't log warnings (default: False)

    Returns:
        EvaluateResult with success, value, and navigation_error flags
    """
    if args is None:
        args = []

    try:
        value = await evaluate(page=page, engine=engine, fn=fn, args=args)
        return EvaluateResult(success=True, value=value, navigation_error=False)
    except Exception as error:
        if is_navigation_error(error):
            if not silent:
                print(
                    f"Navigation detected during {operation_name}, recovering gracefully"
                )
            return EvaluateResult(
                success=False,
                value=default_value,
                navigation_error=True,
            )
        raise
