//! Navigation safety utilities.
//!
//! This module provides utilities for handling navigation-related errors
//! gracefully during browser automation.

use thiserror::Error;

/// Errors related to navigation operations.
#[derive(Debug, Error)]
pub enum NavigationError {
    /// The page was navigated away during an operation.
    #[error("Page navigated away during operation")]
    PageNavigatedAway,

    /// Navigation was interrupted.
    #[error("Navigation was interrupted: {0}")]
    Interrupted(String),

    /// Navigation timed out.
    #[error("Navigation timed out after {0}ms")]
    Timeout(u64),

    /// Target was detached (e.g., tab closed).
    #[error("Target was detached")]
    TargetDetached,

    /// Execution context was destroyed.
    #[error("Execution context was destroyed")]
    ExecutionContextDestroyed,
}

/// Common error messages that indicate a navigation error.
const NAVIGATION_ERROR_PATTERNS: &[&str] = &[
    "navigat", // Matches "navigation", "navigated", etc.
    "detached",
    "context was destroyed",
    "execution context was destroyed",
    "frame was detached",
    "target closed",
    "page has been closed",
    "session closed",
    "cannot find context",
    "protocol error",
];

/// Common error messages that indicate a timeout error.
const TIMEOUT_ERROR_PATTERNS: &[&str] = &["timed out", "timeout", "exceeded", "waiting for"];

/// Check if an error message indicates a navigation error.
///
/// Navigation errors are expected during browser automation when pages
/// navigate away during operations. These errors should generally be
/// handled gracefully.
///
/// # Arguments
///
/// * `error_message` - The error message to check
///
/// # Returns
///
/// `true` if the error appears to be a navigation error
pub fn is_navigation_error(error_message: &str) -> bool {
    NAVIGATION_ERROR_PATTERNS.iter().any(|pattern| {
        error_message
            .to_lowercase()
            .contains(&pattern.to_lowercase())
    })
}

/// Check if an error message indicates a timeout error.
///
/// # Arguments
///
/// * `error_message` - The error message to check
///
/// # Returns
///
/// `true` if the error appears to be a timeout error
pub fn is_timeout_error(error_message: &str) -> bool {
    TIMEOUT_ERROR_PATTERNS.iter().any(|pattern| {
        error_message
            .to_lowercase()
            .contains(&pattern.to_lowercase())
    })
}

/// Execute an operation with navigation safety.
///
/// If the operation fails with a navigation error, returns the default value
/// instead of propagating the error.
///
/// # Arguments
///
/// * `operation` - The async operation to execute
/// * `default` - The value to return on navigation error
///
/// # Returns
///
/// The operation result, or the default value if a navigation error occurred
pub async fn safe_operation<F, T, E>(operation: F, default: T) -> T
where
    F: std::future::Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    match operation.await {
        Ok(value) => value,
        Err(e) if is_navigation_error(&e.to_string()) => default,
        Err(_) => default, // In safe operation mode, return default for any error
    }
}

/// Result wrapper that includes navigation error information.
#[derive(Debug)]
pub struct SafeResult<T> {
    /// The operation result value.
    pub value: T,
    /// Whether the operation was successful.
    pub success: bool,
    /// Whether a navigation error occurred.
    pub navigation_error: bool,
}

impl<T: Default> SafeResult<T> {
    /// Create a successful result.
    pub fn success(value: T) -> Self {
        Self {
            value,
            success: true,
            navigation_error: false,
        }
    }

    /// Create a result from a navigation error.
    pub fn navigation_error() -> Self {
        Self {
            value: T::default(),
            success: false,
            navigation_error: true,
        }
    }

    /// Create a result from a general error.
    pub fn error(value: T) -> Self {
        Self {
            value,
            success: false,
            navigation_error: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_navigation_error_detects_common_patterns() {
        assert!(is_navigation_error("Page navigated away"));
        assert!(is_navigation_error("Target was detached"));
        assert!(is_navigation_error("Execution context was destroyed"));
        assert!(is_navigation_error("frame was detached"));
        assert!(is_navigation_error("Target closed"));
        assert!(is_navigation_error("page has been closed"));
        assert!(is_navigation_error(
            "Session closed. Most likely the page has been closed."
        ));
        assert!(is_navigation_error("Cannot find context with specified id"));
        assert!(is_navigation_error("Protocol error: Target closed"));
    }

    #[test]
    fn is_navigation_error_case_insensitive() {
        assert!(is_navigation_error("NAVIGATION ERROR"));
        assert!(is_navigation_error("Target Detached"));
        assert!(is_navigation_error("CONTEXT WAS DESTROYED"));
    }

    #[test]
    fn is_navigation_error_false_for_other_errors() {
        assert!(!is_navigation_error("Element not found"));
        assert!(!is_navigation_error("Invalid selector"));
        assert!(!is_navigation_error("Network error"));
    }

    #[test]
    fn is_timeout_error_detects_timeout_patterns() {
        assert!(is_timeout_error("Operation timed out"));
        assert!(is_timeout_error("Timeout exceeded"));
        assert!(is_timeout_error("waiting for selector"));
        assert!(is_timeout_error("Timeout"));
    }

    #[test]
    fn is_timeout_error_false_for_other_errors() {
        assert!(!is_timeout_error("Element not found"));
        assert!(!is_timeout_error("Navigation error"));
    }

    #[test]
    fn safe_result_success() {
        let result = SafeResult::success(42);
        assert_eq!(result.value, 42);
        assert!(result.success);
        assert!(!result.navigation_error);
    }

    #[test]
    fn safe_result_navigation_error() {
        let result: SafeResult<i32> = SafeResult::navigation_error();
        assert_eq!(result.value, 0);
        assert!(!result.success);
        assert!(result.navigation_error);
    }

    #[test]
    fn safe_result_error() {
        let result: SafeResult<String> = SafeResult::error("fallback".to_string());
        assert_eq!(result.value, "fallback");
        assert!(!result.success);
        assert!(!result.navigation_error);
    }
}
