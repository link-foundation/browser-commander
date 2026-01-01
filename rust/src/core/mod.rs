//! Core functionality for browser automation.
//!
//! This module contains the fundamental building blocks:
//! - Constants and timing configuration
//! - Logging utilities
//! - Engine abstraction traits
//! - Navigation safety utilities

pub mod constants;
pub mod engine;
pub mod logger;
pub mod navigation;

pub use constants::{Timing, CHROME_ARGS, TIMING};
pub use engine::{
    ClickVerificationResult, ElementInfo, EngineAdapter, EngineError, EngineType,
    FillVerificationResult, PreClickState, ScrollVerificationResult,
};
pub use logger::{init_logger, is_verbose_enabled, Logger, LoggerOptions};
pub use navigation::{
    is_navigation_error, is_timeout_error, safe_operation, NavigationError, SafeResult,
};
