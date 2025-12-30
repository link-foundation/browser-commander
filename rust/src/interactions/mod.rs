//! Interaction operations for browser automation.
//!
//! This module provides utilities for:
//! - Clicking elements
//! - Scrolling elements into view
//! - Filling form elements

pub mod click;
pub mod fill;
pub mod scroll;

pub use click::{
    capture_pre_click_state, click_button, click_element, verify_click, ClickOptions, ClickResult,
};
pub use fill::{fill_text_area, perform_fill, verify_fill, FillOptions, FillResult};
pub use scroll::{
    scroll_into_view, scroll_into_view_if_needed, verify_scroll, ScrollBehavior, ScrollOptions,
    ScrollResult,
};
