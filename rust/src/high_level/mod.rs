//! High-level operations for browser automation.
//!
//! This module provides high-level, DRY-compliant utilities
//! that work across different browser engines.

pub mod universal_logic;

pub use universal_logic::{
    check_and_clear_flag, find_toggle_button, install_click_listener, wait_for_url_condition,
};
