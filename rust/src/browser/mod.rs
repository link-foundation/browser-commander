//! Browser management for browser automation.
//!
//! This module provides utilities for:
//! - Launching browser instances
//! - Navigation operations

pub mod chromiumoxide_adapter;
pub mod connector;
pub mod launcher;
pub mod media;
pub mod navigation_ops;
pub mod node_bridge;
pub mod real_browser;

pub use chromiumoxide_adapter::ChromiumoxidePage;
pub use connector::{connect_browser, ConnectOptions};
pub use launcher::{launch_browser, Browser, LaunchOptions, LaunchResult};
pub use media::{emulate_media, ColorScheme, EmulateMediaOptions};
pub use navigation_ops::{
    goto, verify_navigation, wait_for_navigation, wait_for_url_stabilization, NavigationOptions,
    NavigationResult, NavigationVerificationResult, WaitUntil,
};
pub use node_bridge::NodeBridgePage;
pub use real_browser::{
    assert_dedicated_user_data_dir, build_real_browser_args, default_real_browser_user_data_dir,
    launch_and_connect_real_browser, launch_real_browser, resolve_system_browser_executable,
    BrowserProcess, RealBrowserLaunchResult, RealBrowserOptions,
};
