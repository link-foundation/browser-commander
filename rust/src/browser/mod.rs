//! Browser management for browser automation.
//!
//! This module provides utilities for:
//! - Launching browser instances
//! - Navigation operations

pub mod launcher;
pub mod navigation_ops;

pub use launcher::{launch_browser, Browser, LaunchOptions, LaunchResult};
pub use navigation_ops::{
    goto, verify_navigation, wait_for_navigation, wait_for_url_stabilization,
    NavigationOptions, NavigationResult, NavigationVerificationResult, WaitUntil,
};
