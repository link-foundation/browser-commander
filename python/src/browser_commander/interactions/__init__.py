"""Interaction modules for browser-commander."""

from __future__ import annotations

from browser_commander.interactions.click import (
    ClickResult,
    ClickVerificationResult,
    capture_pre_click_state,
    click_button,
    click_element,
    default_click_verification,
    verify_click,
)
from browser_commander.interactions.fill import (
    FillResult,
    FillVerificationResult,
    check_if_element_empty,
    default_fill_verification,
    fill_text_area,
    perform_fill,
    verify_fill,
)
from browser_commander.interactions.scroll import (
    ScrollResult,
    ScrollVerificationResult,
    default_scroll_verification,
    needs_scrolling,
    scroll_into_view,
    scroll_into_view_if_needed,
    verify_scroll,
)

__all__ = [
    "ClickResult",
    "ClickVerificationResult",
    "FillResult",
    "FillVerificationResult",
    "ScrollResult",
    "ScrollVerificationResult",
    "capture_pre_click_state",
    # Fill
    "check_if_element_empty",
    "click_button",
    # Click
    "click_element",
    "default_click_verification",
    "default_fill_verification",
    "default_scroll_verification",
    "fill_text_area",
    "needs_scrolling",
    "perform_fill",
    # Scroll
    "scroll_into_view",
    "scroll_into_view_if_needed",
    "verify_click",
    "verify_fill",
    "verify_scroll",
]
