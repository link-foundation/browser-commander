"""Utility modules for browser-commander."""

from __future__ import annotations

from browser_commander.utilities.subprocess import (
    CommandError,
    CommandResult,
    ManagedProcess,
    run_command,
    run_command_sync,
    start_process,
)
from browser_commander.utilities.url import (
    get_url,
    unfocus_address_bar,
)
from browser_commander.utilities.wait import (
    EvaluateResult,
    WaitResult,
    evaluate,
    safe_evaluate,
    wait,
)

__all__ = [
    "CommandError",
    "CommandResult",
    "EvaluateResult",
    "ManagedProcess",
    "WaitResult",
    "evaluate",
    # URL
    "get_url",
    "run_command",
    "run_command_sync",
    "safe_evaluate",
    "start_process",
    "unfocus_address_bar",
    # Wait
    "wait",
]
