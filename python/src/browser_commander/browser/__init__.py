"""Browser management modules for browser-commander."""

from __future__ import annotations

from browser_commander.browser.launcher import (
    LaunchOptions,
    LaunchResult,
    launch_browser,
)
from browser_commander.browser.navigation import (
    GotoResult,
    NavigationVerificationResult,
    WaitAfterActionResult,
    default_navigation_verification,
    goto,
    verify_navigation,
    wait_after_action,
    wait_for_navigation,
    wait_for_page_ready,
    wait_for_url_stabilization,
)

__all__ = [
    "GotoResult",
    "LaunchOptions",
    "LaunchResult",
    "NavigationVerificationResult",
    "WaitAfterActionResult",
    "default_navigation_verification",
    # Navigation
    "goto",
    # Launcher
    "launch_browser",
    "verify_navigation",
    "wait_after_action",
    "wait_for_navigation",
    "wait_for_page_ready",
    "wait_for_url_stabilization",
]
