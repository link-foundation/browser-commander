//! Utilities for browser automation.
//!
//! This module provides general-purpose utilities:
//! - URL handling
//! - Wait/sleep operations
//! - Subprocesses through command-stream

pub mod subprocess;
pub mod url;
pub mod wait;

pub use subprocess::{
    run_command, run_command_blocking, start_process, CommandError, CommandOutput, ManagedProcess,
    OutputListener, RunCommandOptions, StartProcessOptions, DEFAULT_KILL_GRACE,
};
pub use url::{
    get_domain, get_url, is_about_url, is_blob_url, is_data_url, parse_url, same_origin,
    unfocus_address_bar,
};
pub use wait::{evaluate, safe_evaluate, wait, wait_with_cancel, SafeEvaluateResult, WaitResult};
