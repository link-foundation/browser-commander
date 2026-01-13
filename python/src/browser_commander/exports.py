"""Browser Commander - Public API exports.

This module centralizes all public exports from the browser-commander library.
"""

from __future__ import annotations

# Re-export core utilities
# Re-export browser management
from browser_commander.browser.launcher import (
    LaunchOptions,
    LaunchResult,
    launch_browser,
)
from browser_commander.browser.navigation import (
    GotoResult,
    NavigationVerificationResult,
    WaitAfterActionResult,
    # Navigation verification
    default_navigation_verification,
    goto,
    verify_navigation,
    wait_after_action,
    wait_for_navigation,
    wait_for_page_ready,
    wait_for_url_stabilization,
)
from browser_commander.core.constants import CHROME_ARGS, TIMING

# Re-export engine adapter
from browser_commander.core.engine_adapter import (
    EngineAdapter,
    PlaywrightAdapter,
    SeleniumAdapter,
    create_engine_adapter,
)
from browser_commander.core.engine_detection import EngineType, detect_engine
from browser_commander.core.logger import create_logger, is_verbose_enabled
from browser_commander.core.navigation_manager import NavigationManager
from browser_commander.core.navigation_safety import (
    is_navigation_error,
    is_timeout_error,
    safe_operation,
    with_navigation_safety,
)

# Re-export new core components
from browser_commander.core.network_tracker import NetworkTracker

# Page trigger system
from browser_commander.core.page_trigger_manager import (
    ActionStoppedError,
    PageTriggerManager,
    all_conditions,
    any_condition,
    is_action_stopped_error,
    make_url_condition,
    not_condition,
)
from browser_commander.elements.content import (
    get_attribute,
    get_input_value,
    input_value,
    log_element_info,
    text_content,
)

# Re-export element operations
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
from browser_commander.elements.visibility import count, is_enabled, is_visible

# Re-export high-level universal logic
from browser_commander.high_level.universal_logic import (
    check_and_clear_flag,
    find_toggle_button,
    install_click_listener,
    wait_for_url_condition,
)
from browser_commander.interactions.click import (
    ClickResult,
    ClickVerificationResult,
    capture_pre_click_state,
    click_button,
    click_element,
    # Click verification
    default_click_verification,
    verify_click,
)
from browser_commander.interactions.fill import (
    FillResult,
    FillVerificationResult,
    check_if_element_empty,
    # Fill verification
    default_fill_verification,
    fill_text_area,
    perform_fill,
    verify_fill,
)

# Re-export interactions
from browser_commander.interactions.scroll import (
    ScrollResult,
    ScrollVerificationResult,
    # Scroll verification
    default_scroll_verification,
    needs_scrolling,
    scroll_into_view,
    scroll_into_view_if_needed,
    verify_scroll,
)
from browser_commander.utilities.url import get_url, unfocus_address_bar

# Re-export utilities
from browser_commander.utilities.wait import (
    EvaluateResult,
    WaitResult,
    evaluate,
    safe_evaluate,
    wait,
)

__all__ = [
    # Core utilities
    "CHROME_ARGS",
    "TIMING",
    "ActionStoppedError",
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
