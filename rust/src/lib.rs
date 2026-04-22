//! Browser Commander - Universal Browser Automation Library
//!
//! A Rust library for browser automation that provides a unified API
//! for different browser automation engines.
//!
//! # Features
//!
//! - Unified API across multiple browser engines
//! - Built-in navigation safety handling
//! - Element visibility and scroll management
//! - Click, fill, and other interaction support with verification
//! - Async/await support with Tokio
//!
//! # Example
//!
//! ```rust,no_run
//! use browser_commander::browser::{launch_browser, LaunchOptions};
//!
//! #[tokio::main]
//! async fn main() -> anyhow::Result<()> {
//!     // Launch a browser
//!     let options = LaunchOptions::chromiumoxide().headless(true);
//!     let result = launch_browser(options).await?;
//!
//!     // The returned `page` is an `Arc<dyn EngineAdapter>` and can be
//!     // passed to any of the crate's navigation / interaction helpers.
//!     let page = result.page.as_ref();
//!     page.goto("https://example.com").await?;
//!     println!("Current URL: {}", page.url().await?);
//!
//!     Ok(())
//! }
//! ```
//!
//! # Modules
//!
//! - [`core`] - Core types and traits (constants, engine adapter, logger)
//! - [`elements`] - Element operations (selectors, visibility, content)
//! - [`interactions`] - User interactions (click, scroll, fill)
//! - [`browser`] - Browser management (launcher, navigation)
//! - [`utilities`] - General utilities (URL handling, wait operations)
//! - [`high_level`] - High-level DRY utilities

pub mod browser;
pub mod core;
pub mod elements;
pub mod high_level;
pub mod interactions;
pub mod utilities;

// Re-export commonly used items at crate root
pub use browser::{
    emulate_media, launch_browser, Browser, ChromiumoxidePage, ColorScheme, EmulateMediaOptions,
    LaunchOptions, LaunchResult,
};
pub use core::{
    DialogEvent, DialogManager, DialogType, EngineAdapter, EngineError, EngineType, Logger,
    LoggerOptions, PdfOptions, Timing, CHROME_ARGS, TIMING,
};

/// Prelude module for convenient imports.
///
/// Import everything commonly needed with:
/// ```rust
/// use browser_commander::prelude::*;
/// ```
pub mod prelude {
    pub use crate::browser::{
        emulate_media, goto, launch_browser, verify_navigation, wait_for_navigation,
        wait_for_url_stabilization, Browser, ColorScheme, EmulateMediaOptions, LaunchOptions,
        LaunchResult, NavigationOptions, NavigationResult, WaitUntil,
    };
    pub use crate::core::{
        is_navigation_error, is_timeout_error, DialogEvent, DialogManager, DialogType,
        EngineAdapter, EngineError, EngineType, Logger, LoggerOptions, PdfOptions, Timing,
        CHROME_ARGS, TIMING,
    };
    pub use crate::elements::{
        count, get_attribute, input_value, is_enabled, is_visible, normalize_selector,
        text_content, ParsedSelector,
    };
    pub use crate::high_level::{
        check_and_clear_flag, find_toggle_button, install_click_listener, wait_for_url_condition,
    };
    pub use crate::interactions::{
        click_button, click_element, fill_text_area, key_down, key_up, perform_fill, press_key,
        scroll_into_view, scroll_into_view_if_needed, type_text, ClickOptions, ClickResult,
        FillOptions, FillResult, ScrollBehavior, ScrollOptions, ScrollResult,
    };
    pub use crate::utilities::{
        evaluate, get_domain, get_url, parse_url, safe_evaluate, same_origin, unfocus_address_bar,
        wait, wait_with_cancel, WaitResult,
    };
}
