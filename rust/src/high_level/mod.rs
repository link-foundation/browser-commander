//! High-level operations for browser automation.
//!
//! This module provides high-level, DRY-compliant utilities
//! that work across different browser engines.

pub mod universal_logic;

pub use universal_logic::{
    check_and_clear_flag, find_toggle_button, find_toggle_button_with_texts,
    install_click_listener, read_flag, uninstall_click_listener, wait_for_url_condition, FlagRead,
};
