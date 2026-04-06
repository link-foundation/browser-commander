"""Browser management modules for browser-commander."""

from __future__ import annotations

from browser_commander.browser.launcher import (
    LaunchOptions,
    LaunchResult,
    launch_browser,
)
from browser_commander.browser.media import emulate_media
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
from browser_commander.browser.pdf import pdf

__all__ = [
    "GotoResult",
    "LaunchOptions",
    "LaunchResult",
    "NavigationVerificationResult",
    "WaitAfterActionResult",
    "default_navigation_verification",
    "emulate_media",
    "goto",
    "launch_browser",
    # PDF generation
    "pdf",
    "verify_navigation",
    "wait_after_action",
    "wait_for_navigation",
    "wait_for_page_ready",
    "wait_for_url_stabilization",
]
