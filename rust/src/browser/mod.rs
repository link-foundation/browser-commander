//! Browser management for browser automation.
//!
//! This module provides utilities for:
//! - Launching browser instances
//! - Navigation operations

mod browser_cookie_cache;
mod browser_cookie_credentials;
mod browser_cookie_crypto;
mod browser_cookies;
pub mod browser_process;
mod browser_profiles;
pub mod cdp_endpoint;
pub mod chromiumoxide_adapter;
pub mod connector;
pub mod debugging_port;
mod engine_launch;
mod launch_executable;
pub mod launcher;
pub mod media;
pub mod migration;
pub mod navigation_ops;
pub mod node_bridge;
pub mod open_in_user_browser;
pub mod parity;
pub mod profile_directory;
pub mod raw_cdp;
pub mod real_browser;
pub mod restrictions;
pub mod snapshot;
pub mod storage_state;
pub mod system_browser;

pub use browser_cookie_cache::clear_browser_cookie_memory_cache;
pub use browser_cookies::{read_browser_cookies, BrowserCookie, BrowserCookieReadOptions};
pub use browser_process::BrowserProcess;
pub use browser_profiles::{
    list_browser_profiles, BrowserProfile, BrowserProfileOptions, SUPPORTED_COOKIE_BROWSERS,
};
pub use cdp_endpoint::{
    fetch_cdp_version, read_dev_tools_active_port, wait_for_cdp_endpoint, CdpEndpointRequest,
};
pub use chromiumoxide_adapter::ChromiumoxidePage;
pub use connector::{connect_browser, ConnectOptions};
pub use debugging_port::{assert_fixed_debugging_port, reserve_loopback_port, PortRaceError};
pub use launcher::{
    launch_browser, Browser, LaunchMode, LaunchOptions, LaunchResult, LAUNCH_MODES,
};
pub use media::{emulate_media, ColorScheme, EmulateMediaOptions};
pub use navigation_ops::{
    goto, verify_navigation, wait_for_navigation, wait_for_url_stabilization, NavigationOptions,
    NavigationResult, NavigationVerificationResult, WaitUntil,
};
pub use node_bridge::NodeBridgePage;
pub use open_in_user_browser::{
    build_open_command, open_in_user_browser, validate_open_url, OpenInUserBrowserResult,
};
pub use profile_directory::{
    create_temporary_user_data_dir, prepare_user_data_dir, remove_user_data_dir,
};
pub use raw_cdp::RawCdpCommand;
pub use real_browser::{
    build_real_browser_args, launch_and_connect_real_browser, launch_real_browser,
    resolve_system_browser_executable, RealBrowserLaunchResult, RealBrowserOptions,
    DEFAULT_CLOSE_TIMEOUT, DEFAULT_PORT_ATTEMPTS,
};
pub use restrictions::{
    launch_restriction_preset, launch_restriction_presets, launch_restrictions,
    merge_feature_switches, resolve_restrictions, LaunchRestriction, ResolvedRestrictions,
    LAUNCH_RESTRICTIONS_SOURCE,
};
pub use snapshot::{
    launch_snapshot, snapshot_user_data_dir, SnapshotLaunchResult, SnapshotOptions, SnapshotReport,
};
pub use storage_state::{
    save_storage_state, StorageEntry, StorageOrigin, StorageState, StorageStateInput,
};
pub use system_browser::{
    assert_dedicated_user_data_dir, default_real_browser_user_data_dir,
    known_default_user_data_dirs, resolve_browser_executable,
};
