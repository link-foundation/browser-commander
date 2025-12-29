//! Element operations for browser automation.
//!
//! This module provides utilities for:
//! - Working with CSS selectors
//! - Checking element visibility
//! - Extracting element content

pub mod content;
pub mod selectors;
pub mod visibility;

pub use content::{
    get_attribute, input_value, is_element_empty, text_content, truncate_for_preview,
    ElementLogInfo,
};
pub use selectors::{
    build_text_selector, escape_selector_value, extract_text_from_selector, has_nth_of_type,
    is_text_selector, normalize_selector, parse_nth_of_type, ParsedSelector,
};
pub use visibility::{count, is_enabled, is_in_viewport, is_visible, needs_scrolling};
