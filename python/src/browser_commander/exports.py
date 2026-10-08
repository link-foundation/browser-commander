"""Browser Commander - Public API exports.

This module centralizes all public exports from the browser-commander library.
"""

from __future__ import annotations

from browser_commander.browser.browser_cookie_session import (
    find_site_sessions,
    read_browser_cookie_session,
)

# Re-export core utilities
# Re-export browser management
from browser_commander.browser.browser_cookies import (
    BrowserCookieCacheOptions,
    BrowserCookieReadOptions,
    BrowserProfile,
    CookieSource,
    ImportSource,
    list_browser_profiles,
    list_cookie_sources,
    read_browser_cookies,
    resolve_import_source,
)
from browser_commander.browser.connector import (
    ConnectOptions,
    connect_browser,
    pick_foreground_page,
)
from browser_commander.browser.debugging_port import (
    PortRaceError,
    assert_fixed_debugging_port,
    reserve_loopback_port,
)
from browser_commander.browser.extension_relay import (
    ExtensionRelay,
    RelayAddress,
    RelayEvent,
    RelayExtension,
    RelayOptions,
    RelaySession,
    RelayTab,
    attach_via_extension,
    extension_directory,
)
from browser_commander.browser.launch_diagnostics import BrowserLaunchError
from browser_commander.browser.launcher import (
    LAUNCH_MODES,
    LaunchOptions,
    LaunchResult,
    launch_browser,
    resolve_launch_executable,
)
from browser_commander.browser.media import emulate_media
from browser_commander.browser.migration import ALL_DATA_CLASSES, migrate_profile
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
from browser_commander.browser.open_in_user_browser import (
    build_open_command,
    open_in_user_browser,
    validate_open_url,
)
from browser_commander.browser.parity import (
    classify_differences,
    compare_command_lines,
    measure_parity,
    parse_switches,
    read_browser_version_page,
)
from browser_commander.browser.pdf import pdf
from browser_commander.browser.profile_directory import (
    create_temporary_user_data_dir,
    prepare_user_data_dir,
    remove_user_data_dir,
)
from browser_commander.browser.real_browser import (
    RealBrowserOptions,
    RealBrowserResult,
    build_real_browser_args,
    launch_and_connect_real_browser,
    launch_real_browser,
)
from browser_commander.browser.restrictions import (
    LAUNCH_RESTRICTION_PRESETS,
    LAUNCH_RESTRICTIONS,
    browser_environment,
    merge_feature_switches,
    resolve_restrictions,
)
from browser_commander.browser.safari_webdriver import (
    SafariSetupError,
    SafariUnsupportedError,
    open_safari_settings,
    require_safari_feature,
)
from browser_commander.browser.session_cookies import clear_cookies, set_cookies
from browser_commander.browser.snapshot import (
    SnapshotOptions,
    launch_snapshot,
    snapshot_user_data_dir,
)
from browser_commander.browser.storage_state import (
    load_storage_state,
    save_storage_state,
)
from browser_commander.core.constants import CHROME_ARGS, TIMING

# Re-export new core components
from browser_commander.core.dialog_manager import DialogManager

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
from browser_commander.core.readiness import (
    LONG_LIVED_REQUEST_PATTERNS,
    Deadline,
    ReadinessCheck,
    ReadinessResult,
    ReadinessStatus,
    dom_stable_for,
    is_long_lived_request,
    network_idle_for,
    predicate,
    run_readiness_checks,
    stable_check,
    url_stable_for,
    visible_images,
)

# Re-export managed downloads
from browser_commander.downloads import (
    DEFAULT_CAPTURE_TIMEOUT,
    DownloadArtifact,
    DownloadConflict,
    DownloadDirectoryPreset,
    DownloadEvent,
    DownloadFailure,
    DownloadManager,
    DownloadSource,
    SavedDownload,
    attach_downloads,
    create_download_manager,
    normalize_download_options,
    prepare_download_directory,
    resolve_download_directory,
    save_download,
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
from browser_commander.elements.reusable import check, find_first, has_text, is_checked
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
from browser_commander.fingerprint.apply import (
    AppliedFingerprint,
    apply_fingerprint,
    create_cdp_session,
)
from browser_commander.fingerprint.automation_parity import (
    AUTOMATION_CONTROLLED_OFF_ARG,
    AUTOMATION_CONTROLLED_TRIGGERS,
    PLAYWRIGHT_HEADLESS_POINTER_ARG,
    PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
    apply_automation_parity_args,
    detect_automation_controlled_triggers,
    disables_automation_controlled,
    parity_ignored_default_args,
)
from browser_commander.fingerprint.cdp_overrides import (
    CdpCommand,
    build_cdp_emulation_commands,
)
from browser_commander.fingerprint.derive import derive_user_agent_data
from browser_commander.fingerprint.init_script import (
    build_fingerprint_init_script,
    build_init_script_config,
)
from browser_commander.fingerprint.limitations import (
    FINGERPRINT_LIMITATIONS,
    find_fingerprint_limitation,
    relevant_fingerprint_limitations,
)
from browser_commander.fingerprint.presets import (
    FINGERPRINT_PRESET_NAMES,
    create_fingerprint_preset,
)
from browser_commander.fingerprint.profile import (
    FINGERPRINT_FIELD_MECHANISMS,
    resolve_fingerprint_profile,
)

# Re-export high-level universal logic
from browser_commander.high_level.universal_logic import (
    check_and_clear_flag,
    find_toggle_button,
    install_click_listener,
    read_flag,
    uninstall_click_listener,
    wait_for_url_condition,
)
from browser_commander.interactions.click import (
    ClickActionability,
    ClickActivation,
    ClickEffect,
    ClickResult,
    ClickScroll,
    ClickStatus,
    ClickVerificationResult,
    ScrollConstraintError,
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
from browser_commander.interactions.keyboard import (
    key_down,
    key_up,
    press_key,
    type_text,
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

# Re-export the portable trace format: one versioned bundle, readable from
# every language the library ships in (issue #87).
from browser_commander.traces import (
    TRACE_EVENT_SOURCES,
    TRACE_SCHEMA_VERSION,
    ControlChange,
    ParsedNdjson,
    Trace,
    TraceCheckpoint,
    TraceEvent,
    TraceFiles,
    TraceMode,
    TraceOutcome,
    diff_control_state,
    parse_ndjson,
    read_trace,
)
from browser_commander.utilities.subprocess import (
    CommandError,
    ManagedProcess,
    run_command,
    start_process,
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
    # Open in the user's browser, profile migration and parity (#102, #103)
    "ALL_DATA_CLASSES",
    # Core utilities
    "AUTOMATION_CONTROLLED_OFF_ARG",
    "AUTOMATION_CONTROLLED_TRIGGERS",
    "CHROME_ARGS",
    # Managed downloads
    "DEFAULT_CAPTURE_TIMEOUT",
    "FINGERPRINT_FIELD_MECHANISMS",
    "FINGERPRINT_LIMITATIONS",
    "FINGERPRINT_PRESET_NAMES",
    # Real launch (issues #101, #103) and subprocess helpers
    "LAUNCH_MODES",
    "LAUNCH_RESTRICTIONS",
    "LAUNCH_RESTRICTION_PRESETS",
    "LONG_LIVED_REQUEST_PATTERNS",
    "PLAYWRIGHT_HEADLESS_POINTER_ARG",
    "PLAYWRIGHT_SOFTWARE_WEBGL_ARG",
    "TIMING",
    # Portable traces
    "TRACE_EVENT_SOURCES",
    "TRACE_SCHEMA_VERSION",
    "ActionStoppedError",
    "AppliedFingerprint",
    "BrowserCookieCacheOptions",
    "BrowserCookieReadOptions",
    "BrowserLaunchError",
    "BrowserProfile",
    "CdpCommand",
    "ClickActionability",
    "ClickActivation",
    "ClickEffect",
    "ClickResult",
    "ClickScroll",
    "ClickStatus",
    "ClickVerificationResult",
    "CommandError",
    "ConnectOptions",
    "ControlChange",
    "CookieSource",
    "Deadline",
    "DialogManager",
    "DownloadArtifact",
    "DownloadConflict",
    "DownloadDirectoryPreset",
    "DownloadEvent",
    "DownloadFailure",
    "DownloadManager",
    "DownloadSource",
    # Engine adapter
    "EngineAdapter",
    "EngineType",
    "EvaluateResult",
    "ExtensionRelay",
    "FillResult",
    "FillVerificationResult",
    "GotoResult",
    "ImportSource",
    "LaunchOptions",
    "LaunchResult",
    "ManagedProcess",
    "NavigationManager",
    "NavigationVerificationResult",
    # Core components
    "NetworkTracker",
    # Page trigger system
    "PageTriggerManager",
    "ParsedNdjson",
    "PlaywrightAdapter",
    "PortRaceError",
    "ReadinessCheck",
    "ReadinessResult",
    "ReadinessStatus",
    "RealBrowserOptions",
    "RealBrowserResult",
    "RelayAddress",
    "RelayEvent",
    "RelayExtension",
    "RelayOptions",
    "RelaySession",
    "RelayTab",
    "SafariSetupError",
    "SafariUnsupportedError",
    "SavedDownload",
    "ScrollConstraintError",
    "ScrollResult",
    "ScrollVerificationResult",
    "SeleniumAdapter",
    "SeleniumLocatorWrapper",
    "SeleniumTextSelector",
    "SnapshotOptions",
    "Trace",
    "TraceCheckpoint",
    "TraceEvent",
    "TraceFiles",
    "TraceMode",
    "TraceOutcome",
    "WaitAfterActionResult",
    "WaitResult",
    "all_conditions",
    "any_condition",
    "apply_automation_parity_args",
    "apply_fingerprint",
    "assert_fixed_debugging_port",
    "attach_downloads",
    "attach_via_extension",
    "browser_environment",
    "build_cdp_emulation_commands",
    "build_fingerprint_init_script",
    "build_init_script_config",
    "build_open_command",
    "build_real_browser_args",
    "capture_pre_click_state",
    "check",
    "check_and_clear_flag",
    # Fill interactions
    "check_if_element_empty",
    "classify_differences",
    "clear_cookies",
    "click_button",
    # Click interactions
    "click_element",
    "compare_command_lines",
    "connect_browser",
    "count",
    "create_cdp_session",
    "create_download_manager",
    "create_engine_adapter",
    "create_fingerprint_preset",
    "create_logger",
    # Element locators
    "create_playwright_locator",
    "create_temporary_user_data_dir",
    "default_click_verification",
    "default_fill_verification",
    "default_navigation_verification",
    "default_scroll_verification",
    "derive_user_agent_data",
    "detect_automation_controlled_triggers",
    "detect_engine",
    "diff_control_state",
    "disables_automation_controlled",
    "dom_stable_for",
    "emulate_media",
    "evaluate",
    "extension_directory",
    "fill_text_area",
    "find_by_text",
    "find_fingerprint_limitation",
    "find_first",
    "find_site_sessions",
    "find_toggle_button",
    "get_attribute",
    "get_input_value",
    "get_locator_or_element",
    "get_url",
    "goto",
    "has_text",
    "input_value",
    "install_click_listener",
    "is_action_stopped_error",
    "is_checked",
    "is_enabled",
    "is_long_lived_request",
    "is_navigation_error",
    "is_timeout_error",
    "is_verbose_enabled",
    # Element visibility
    "is_visible",
    "key_down",
    "key_up",
    # Browser management
    "launch_and_connect_real_browser",
    "launch_browser",
    "launch_real_browser",
    "launch_snapshot",
    "list_browser_profiles",
    "list_cookie_sources",
    "load_storage_state",
    "locator",
    "log_element_info",
    "make_url_condition",
    "measure_parity",
    "merge_feature_switches",
    "migrate_profile",
    "needs_scrolling",
    "network_idle_for",
    "normalize_download_options",
    "normalize_selector",
    "not_condition",
    "open_in_user_browser",
    "open_safari_settings",
    "parity_ignored_default_args",
    "parse_ndjson",
    "parse_switches",
    "pdf",
    "perform_fill",
    "pick_foreground_page",
    "predicate",
    "prepare_download_directory",
    "prepare_user_data_dir",
    # Keyboard interactions
    "press_key",
    # Element selectors
    "query_selector",
    "query_selector_all",
    "read_browser_cookie_session",
    "read_browser_cookies",
    "read_browser_version_page",
    "read_flag",
    "read_trace",
    "relevant_fingerprint_limitations",
    "remove_user_data_dir",
    "require_safari_feature",
    "reserve_loopback_port",
    "resolve_download_directory",
    "resolve_fingerprint_profile",
    "resolve_import_source",
    "resolve_launch_executable",
    "resolve_restrictions",
    "run_command",
    "run_readiness_checks",
    "safe_evaluate",
    "safe_operation",
    "save_download",
    "save_storage_state",
    # Scroll interactions
    "scroll_into_view",
    "scroll_into_view_if_needed",
    "set_cookies",
    "snapshot_user_data_dir",
    "stable_check",
    "start_process",
    # Element content
    "text_content",
    "type_text",
    "unfocus_address_bar",
    "uninstall_click_listener",
    "url_stable_for",
    "validate_open_url",
    "verify_click",
    "verify_fill",
    "verify_navigation",
    "verify_scroll",
    "visible_images",
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
