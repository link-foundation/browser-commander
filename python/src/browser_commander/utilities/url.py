"""URL utilities for browser-commander.

This module provides URL-related functions for both Playwright and Selenium engines.
"""

from __future__ import annotations

from typing import Any


def get_url(page: Any) -> str:
    """Get current URL.

    Args:
        page: Browser page object

    Returns:
        Current URL string
    """
    # Playwright
    if hasattr(page, "url"):
        if callable(page.url):
            return page.url()
        return page.url

    # Selenium
    if hasattr(page, "current_url"):
        return page.current_url

    return ""


async def unfocus_address_bar(page: Any) -> None:
    """Unfocus address bar to prevent it from being selected.

    Fixes the annoying issue where address bar is focused after browser
    launch/navigation. Uses page.bring_to_front() as recommended by
    Puppeteer/Playwright communities.

    Args:
        page: Browser page object
    """
    if not page:
        raise ValueError("page is required")

    try:
        # Playwright
        if hasattr(page, "bring_to_front"):
            await page.bring_to_front()
        # Selenium doesn't need this - focus is handled differently
    except Exception:
        # Ignore errors - this is just a UX improvement
        pass
