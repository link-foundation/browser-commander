"""Element operation modules for browser-commander."""

from __future__ import annotations

from browser_commander.elements.content import (
    get_attribute,
    get_input_value,
    input_value,
    log_element_info,
    text_content,
)
from browser_commander.elements.locators import (
    SeleniumLocatorWrapper,
    create_playwright_locator,
    get_locator_or_element,
    locator,
    wait_for_locator_or_element,
    wait_for_visible,
)
from browser_commander.elements.selectors import (
    SeleniumTextSelector,
    find_by_text,
    normalize_selector,
    query_selector,
    query_selector_all,
    wait_for_selector,
    with_text_selector_support,
)
from browser_commander.elements.visibility import (
    count,
    is_enabled,
    is_visible,
)

__all__ = [
    "SeleniumLocatorWrapper",
    "SeleniumTextSelector",
    "count",
    # Locators
    "create_playwright_locator",
    "find_by_text",
    "get_attribute",
    "get_input_value",
    "get_locator_or_element",
    "input_value",
    "is_enabled",
    # Visibility
    "is_visible",
    "locator",
    "log_element_info",
    "normalize_selector",
    # Selectors
    "query_selector",
    "query_selector_all",
    # Content
    "text_content",
    "wait_for_locator_or_element",
    "wait_for_selector",
    "wait_for_visible",
    "with_text_selector_support",
]
