//! Core functionality for browser automation.
//!
//! This module contains the fundamental building blocks:
//! - Constants and timing configuration
//! - Logging utilities
//! - Engine abstraction traits
//! - Navigation safety utilities
//! - Readiness deadlines and evidence

pub mod constants;
pub mod dialog;
pub mod engine;
pub mod logger;
pub mod navigation;
pub mod readiness;
#[cfg(test)]
pub mod stub_engine;

pub use constants::{Timing, CHROME_ARGS, TIMING};
pub use dialog::{DialogEvent, DialogHandler, DialogManager, DialogType};
pub use engine::{
    ClickVerificationResult, ElementInfo, EngineAdapter, EngineError, EngineType,
    FillVerificationResult, PdfOptions, PreClickState, ScrollVerificationResult,
};
pub use logger::{init_logger, is_verbose_enabled, Logger, LoggerOptions};
pub use navigation::{
    is_navigation_error, is_timeout_error, safe_operation, NavigationError, SafeResult,
};
pub use readiness::{
    run_within_deadline, CheckRecord, Deadline, DeadlineOutcome, ReadinessOutcome, ReadinessStatus,
};
