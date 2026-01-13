"""Navigation safety utilities for handling navigation errors gracefully."""

from __future__ import annotations

from typing import Any, Callable


class NavigationError(Exception):
    """Exception raised when navigation is interrupted or fails."""

    pass


def is_navigation_error(error: Exception) -> bool:
    """Check if an error is a navigation-related error.

    Args:
        error: The exception to check

    Returns:
        True if this is a navigation error that should be handled gracefully
    """
    if isinstance(error, NavigationError):
        return True

    error_message = str(error).lower()

    # Common Playwright navigation error patterns
    playwright_patterns = [
        "navigation",
        "frame was detached",
        "execution context was destroyed",
        "target closed",
        "page closed",
        "browser closed",
        "target crashed",
        "context destroyed",
    ]

    # Common Selenium navigation error patterns
    selenium_patterns = [
        "stale element reference",
        "no such element",
        "no such window",
        "session deleted",
        "target frame detached",
        "web element reference",
    ]

    all_patterns = playwright_patterns + selenium_patterns

    return any(pattern in error_message for pattern in all_patterns)


def is_timeout_error(error: Exception) -> bool:
    """Check if an error is a timeout error.

    Args:
        error: The exception to check

    Returns:
        True if this is a timeout error
    """
    error_message = str(error).lower()

    timeout_patterns = [
        "timeout",
        "timed out",
        "exceeded",
        "deadline",
    ]

    return any(pattern in error_message for pattern in timeout_patterns)


def safe_operation(
    default_value: Any = None,
    log_message: str | None = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator that wraps a function to handle navigation errors gracefully.

    Args:
        default_value: Value to return if a navigation error occurs
        log_message: Optional message to log when recovering from navigation error

    Returns:
        Decorator function
    """

    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return await func(*args, **kwargs)
            except Exception as e:
                if is_navigation_error(e):
                    if log_message:
                        print(f"[WARN] {log_message}")
                    return default_value
                raise

        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                return func(*args, **kwargs)
            except Exception as e:
                if is_navigation_error(e):
                    if log_message:
                        print(f"[WARN] {log_message}")
                    return default_value
                raise

        import asyncio

        if asyncio.iscoroutinefunction(func):
            return async_wrapper
        return sync_wrapper

    return decorator


# Alias for backwards compatibility / clarity
with_navigation_safety = safe_operation
