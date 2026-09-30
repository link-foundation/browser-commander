"""Browser management modules for browser-commander."""

from __future__ import annotations

from browser_commander.browser.browser_cookies import (
    BrowserCookieCacheOptions,
    BrowserCookieReadOptions,
    BrowserProfile,
    list_browser_profiles,
    read_browser_cookies,
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
from browser_commander.browser.snapshot import (
    SnapshotOptions,
    launch_snapshot,
    snapshot_user_data_dir,
)
from browser_commander.browser.storage_state import (
    load_storage_state,
    save_storage_state,
)

__all__ = [
    "ALL_DATA_CLASSES",
    "LAUNCH_MODES",
    "LAUNCH_RESTRICTIONS",
    "LAUNCH_RESTRICTION_PRESETS",
    "BrowserCookieCacheOptions",
    "BrowserCookieReadOptions",
    "BrowserProfile",
    "ConnectOptions",
    "GotoResult",
    "LaunchOptions",
    "LaunchResult",
    "NavigationVerificationResult",
    "PortRaceError",
    "RealBrowserOptions",
    "RealBrowserResult",
    "SnapshotOptions",
    "WaitAfterActionResult",
    "assert_fixed_debugging_port",
    "browser_environment",
    "build_open_command",
    "build_real_browser_args",
    "classify_differences",
    "compare_command_lines",
    "connect_browser",
    "create_temporary_user_data_dir",
    "default_navigation_verification",
    "emulate_media",
    "goto",
    "launch_and_connect_real_browser",
    "launch_browser",
    "launch_real_browser",
    "launch_snapshot",
    "list_browser_profiles",
    "load_storage_state",
    "measure_parity",
    "merge_feature_switches",
    "migrate_profile",
    "open_in_user_browser",
    "parse_switches",
    # PDF generation
    "pdf",
    "pick_foreground_page",
    "prepare_user_data_dir",
    "read_browser_cookies",
    "read_browser_version_page",
    "remove_user_data_dir",
    "reserve_loopback_port",
    "resolve_launch_executable",
    "resolve_restrictions",
    "save_storage_state",
    "snapshot_user_data_dir",
    "validate_open_url",
    "verify_navigation",
    "wait_after_action",
    "wait_for_navigation",
    "wait_for_page_ready",
    "wait_for_url_stabilization",
]
