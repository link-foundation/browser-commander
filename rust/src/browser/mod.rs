//! Browser management for browser automation.
//!
//! This module provides utilities for:
//! - Launching browser instances
//! - Navigation operations

mod browser_cookie_cache;
mod browser_cookie_credentials;
mod browser_cookie_crypto;
mod browser_cookies;
mod browser_profiles;
pub mod chromiumoxide_adapter;
pub mod connector;
pub mod launcher;
pub mod media;
pub mod navigation_ops;
pub mod node_bridge;

pub use browser_cookie_cache::clear_browser_cookie_memory_cache;
pub use browser_cookies::{read_browser_cookies, BrowserCookie, BrowserCookieReadOptions};
pub use browser_profiles::{
    list_browser_profiles, BrowserProfile, BrowserProfileOptions, SUPPORTED_COOKIE_BROWSERS,
};
pub use chromiumoxide_adapter::ChromiumoxidePage;
pub use connector::{connect_browser, ConnectOptions};
pub use launcher::{launch_browser, Browser, LaunchOptions, LaunchResult};
pub use media::{emulate_media, ColorScheme, EmulateMediaOptions};
pub use navigation_ops::{
    goto, verify_navigation, wait_for_navigation, wait_for_url_stabilization, NavigationOptions,
    NavigationResult, NavigationVerificationResult, WaitUntil,
};
pub use node_bridge::NodeBridgePage;
