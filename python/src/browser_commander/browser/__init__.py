"""Browser management modules for browser-commander."""

from __future__ import annotations

from browser_commander.browser.browser_cookies import (
    BrowserCookieCacheOptions,
    BrowserCookieReadOptions,
    BrowserProfile,
    list_browser_profiles,
    read_browser_cookies,
)
from browser_commander.browser.connector import ConnectOptions, connect_browser
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
    "BrowserCookieCacheOptions",
    "BrowserCookieReadOptions",
    "BrowserProfile",
    "ConnectOptions",
    "GotoResult",
    "LaunchOptions",
    "LaunchResult",
    "NavigationVerificationResult",
    "WaitAfterActionResult",
    "connect_browser",
    "default_navigation_verification",
    "emulate_media",
    "goto",
    "launch_browser",
    "list_browser_profiles",
    # PDF generation
    "pdf",
    "read_browser_cookies",
    "verify_navigation",
    "wait_after_action",
    "wait_for_navigation",
    "wait_for_page_ready",
    "wait_for_url_stabilization",
]
