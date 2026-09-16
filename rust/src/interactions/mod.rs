//! Interaction operations for browser automation.
//!
//! This module provides utilities for:
//! - Clicking elements
//! - Scrolling elements into view
//! - Filling form elements
//! - Page-level keyboard input

pub mod click;
pub mod click_activation;
pub mod click_result;
pub mod fill;
pub mod keyboard;
pub mod scroll;

pub use click::{capture_pre_click_state, click_button, click_element, verify_click, ClickOptions};
pub use click_activation::{
    dispatch_click, measure_click_point, read_scroll_position, restore_scroll_position,
    ActivationOptions, ClickActionability, ClickActivation, ClickDispatchError, ClickPoint,
    ClickScroll, DispatchDetail, ScrollPosition, NO_AUTO_SCROLL_DEPRECATION,
};
pub use click_result::{next_action_id, ClickEffect, ClickResult, ClickStatus, Evidence};
pub use fill::{fill_text_area, perform_fill, verify_fill, FillOptions, FillResult};
pub use keyboard::{key_down, key_up, press_key, type_text};
pub use scroll::{
    scroll_into_view, scroll_into_view_if_needed, verify_scroll, ScrollBehavior, ScrollOptions,
    ScrollResult,
};
