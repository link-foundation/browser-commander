"""Logging utilities for browser-commander."""

from __future__ import annotations

import logging
import os
import sys
from typing import Callable


def is_verbose_enabled() -> bool:
    """Check if verbose logging is enabled via environment or CLI args."""
    return bool(os.environ.get("VERBOSE")) or "--verbose" in sys.argv


class Logger:
    """Logger instance with verbose level control."""

    def __init__(self, verbose: bool = False) -> None:
        """Initialize logger with optional verbose mode.

        Args:
            verbose: Enable verbose/debug logging
        """
        self._verbose = verbose
        self._logger = logging.getLogger("browser_commander")

        # Configure handler if not already done
        if not self._logger.handlers:
            handler = logging.StreamHandler()
            formatter = logging.Formatter("%(message)s")
            handler.setFormatter(formatter)
            self._logger.addHandler(handler)

        self._logger.setLevel(logging.DEBUG if verbose else logging.ERROR)

    def debug(self, message_fn: Callable[[], str]) -> None:
        """Log debug message using lazy evaluation.

        Args:
            message_fn: Function that returns the message string (called only if
                debug level is enabled)
        """
        if self._verbose:
            self._logger.debug(message_fn())

    def info(self, message: str) -> None:
        """Log info message.

        Args:
            message: Message to log
        """
        self._logger.info(message)

    def warning(self, message: str) -> None:
        """Log warning message.

        Args:
            message: Message to log
        """
        self._logger.warning(message)

    def error(self, message: str) -> None:
        """Log error message.

        Args:
            message: Message to log
        """
        self._logger.error(message)


def create_logger(verbose: bool = False) -> Logger:
    """Create a logger instance with verbose level control.

    Args:
        verbose: Enable verbose/debug logging

    Returns:
        Logger instance
    """
    return Logger(verbose=verbose)
