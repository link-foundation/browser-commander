"""
Browser Commander - Universal browser automation library for Python.

Supports both Playwright and Selenium with a unified API.
All functions use options dictionaries for easy maintenance.

Key features:
- Automatic network request tracking
- Navigation-aware operations (wait for page ready after navigations)
- Event-based page lifecycle management
- Session management for per-page automation logic
"""

from __future__ import annotations

from browser_commander.exports import (
    # Core utilities
    CHROME_ARGS,
    TIMING,
    ActionStoppedError,
    ClickResult,
    ClickVerificationResult,
    # Engine adapter
    EngineAdapter,
    EngineType,
    EvaluateResult,
    FillResult,
    FillVerificationResult,
    GotoResult,
    LaunchOptions,
    LaunchResult,
    NavigationManager,
    NavigationVerificationResult,
    # Core components
    NetworkTracker,
    # Page trigger system
    PageTriggerManager,
    PlaywrightAdapter,
    ScrollResult,
    ScrollVerificationResult,
    SeleniumAdapter,
    SeleniumLocatorWrapper,
    SeleniumTextSelector,
    WaitAfterActionResult,
    WaitResult,
    all_conditions,
    any_condition,
    capture_pre_click_state,
    check_and_clear_flag,
    # Fill interactions
    check_if_element_empty,
    click_button,
    # Click interactions
    click_element,
    count,
    create_engine_adapter,
    create_logger,
    # Element locators
    create_playwright_locator,
    default_click_verification,
    default_fill_verification,
    default_navigation_verification,
    default_scroll_verification,
    detect_engine,
    evaluate,
    fill_text_area,
    find_by_text,
    find_toggle_button,
    get_attribute,
    get_input_value,
    get_locator_or_element,
    get_url,
    goto,
    input_value,
    install_click_listener,
    is_action_stopped_error,
    is_enabled,
    is_navigation_error,
    is_timeout_error,
    is_verbose_enabled,
    # Element visibility
    is_visible,
    # Browser management
    launch_browser,
    locator,
    log_element_info,
    make_url_condition,
    needs_scrolling,
    normalize_selector,
    not_condition,
    perform_fill,
    # Element selectors
    query_selector,
    query_selector_all,
    safe_evaluate,
    safe_operation,
    # Scroll interactions
    scroll_into_view,
    scroll_into_view_if_needed,
    # Element content
    text_content,
    unfocus_address_bar,
    verify_click,
    verify_fill,
    verify_navigation,
    verify_scroll,
    # Utilities
    wait,
    wait_after_action,
    wait_for_locator_or_element,
    wait_for_navigation,
    wait_for_page_ready,
    wait_for_selector,
    # High-level
    wait_for_url_condition,
    wait_for_url_stabilization,
    wait_for_visible,
    with_navigation_safety,
    with_text_selector_support,
)
from browser_commander.factory import BrowserCommander, make_browser_commander

__version__ = "0.1.0"
__all__ = [
    # Core utilities
    "CHROME_ARGS",
    "TIMING",
    "ActionStoppedError",
    # Factory
    "BrowserCommander",
    "ClickResult",
    "ClickVerificationResult",
    # Engine adapter
    "EngineAdapter",
    "EngineType",
    "EvaluateResult",
    "FillResult",
    "FillVerificationResult",
    "GotoResult",
    "LaunchOptions",
    "LaunchResult",
    "NavigationManager",
    "NavigationVerificationResult",
    # Core components
    "NetworkTracker",
    # Page trigger system
    "PageTriggerManager",
    "PlaywrightAdapter",
    "ScrollResult",
    "ScrollVerificationResult",
    "SeleniumAdapter",
    "SeleniumLocatorWrapper",
    "SeleniumTextSelector",
    "WaitAfterActionResult",
    "WaitResult",
    "all_conditions",
    "any_condition",
    "capture_pre_click_state",
    "check_and_clear_flag",
    # Fill interactions
    "check_if_element_empty",
    "click_button",
    # Click interactions
    "click_element",
    "count",
    "create_engine_adapter",
    "create_logger",
    # Element locators
    "create_playwright_locator",
    "default_click_verification",
    "default_fill_verification",
    "default_navigation_verification",
    "default_scroll_verification",
    "detect_engine",
    "evaluate",
    "fill_text_area",
    "find_by_text",
    "find_toggle_button",
    "get_attribute",
    "get_input_value",
    "get_locator_or_element",
    "get_url",
    "goto",
    "input_value",
    "install_click_listener",
    "is_action_stopped_error",
    "is_enabled",
    "is_navigation_error",
    "is_timeout_error",
    "is_verbose_enabled",
    # Element visibility
    "is_visible",
    # Browser management
    "launch_browser",
    "locator",
    "log_element_info",
    "make_browser_commander",
    "make_url_condition",
    "needs_scrolling",
    "normalize_selector",
    "not_condition",
    "perform_fill",
    # Element selectors
    "query_selector",
    "query_selector_all",
    "safe_evaluate",
    "safe_operation",
    # Scroll interactions
    "scroll_into_view",
    "scroll_into_view_if_needed",
    # Element content
    "text_content",
    "unfocus_address_bar",
    "verify_click",
    "verify_fill",
    "verify_navigation",
    "verify_scroll",
    # Utilities
    "wait",
    "wait_after_action",
    "wait_for_locator_or_element",
    "wait_for_navigation",
    "wait_for_page_ready",
    "wait_for_selector",
    # High-level
    "wait_for_url_condition",
    "wait_for_url_stabilization",
    "wait_for_visible",
    "with_navigation_safety",
    "with_text_selector_support",
]
