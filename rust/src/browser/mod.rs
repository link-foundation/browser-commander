//! Browser management for browser automation.
//!
//! This module provides utilities for:
//! - Launching browser instances
//! - Navigation operations

pub mod chromiumoxide_adapter;
pub mod launcher;
pub mod media;
pub mod navigation_ops;

pub use chromiumoxide_adapter::ChromiumoxidePage;
pub use launcher::{launch_browser, Browser, LaunchOptions, LaunchResult};
pub use media::{emulate_media, ColorScheme, EmulateMediaOptions};
pub use navigation_ops::{
    goto, verify_navigation, wait_for_navigation, wait_for_url_stabilization, NavigationOptions,
    NavigationResult, NavigationVerificationResult, WaitUntil,
};
