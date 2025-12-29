//! Wait/sleep utilities for browser automation.
//!
//! This module provides utilities for waiting and sleeping
//! with optional abort signal support.

use crate::core::engine::{EngineAdapter, EngineError};
use crate::core::navigation::is_navigation_error;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

/// Result of a wait operation.
#[derive(Debug, Clone)]
pub struct WaitResult {
    /// Whether the wait completed normally.
    pub completed: bool,
    /// Whether the wait was aborted.
    pub aborted: bool,
}

impl WaitResult {
    /// Create a completed result.
    pub fn completed() -> Self {
        Self {
            completed: true,
            aborted: false,
        }
    }

    /// Create an aborted result.
    pub fn aborted() -> Self {
        Self {
            completed: false,
            aborted: true,
        }
    }
}

/// Wait for a specified duration.
///
/// # Arguments
///
/// * `duration` - How long to wait
/// * `reason` - Reason for waiting (for logging)
///
/// # Returns
///
/// The wait result
pub async fn wait(duration: Duration, _reason: Option<&str>) -> WaitResult {
    tokio::time::sleep(duration).await;
    WaitResult::completed()
}

/// Wait for a specified duration with abort support.
///
/// # Arguments
///
/// * `duration` - How long to wait
/// * `cancel_token` - Cancellation token to abort the wait
/// * `reason` - Reason for waiting (for logging)
///
/// # Returns
///
/// The wait result
pub async fn wait_with_cancel(
    duration: Duration,
    cancel_token: &CancellationToken,
    _reason: Option<&str>,
) -> WaitResult {
    // Check if already cancelled
    if cancel_token.is_cancelled() {
        return WaitResult::aborted();
    }

    tokio::select! {
        _ = tokio::time::sleep(duration) => {
            WaitResult::completed()
        }
        _ = cancel_token.cancelled() => {
            WaitResult::aborted()
        }
    }
}

/// Evaluate JavaScript in the page context.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `script` - The JavaScript to evaluate
///
/// # Returns
///
/// The result of the evaluation
pub async fn evaluate(
    adapter: &dyn EngineAdapter,
    script: &str,
) -> Result<serde_json::Value, EngineError> {
    adapter.evaluate(script).await
}

/// Safe evaluate that catches navigation errors and returns a default value.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `script` - The JavaScript to evaluate
/// * `default` - Default value to return on navigation error
///
/// # Returns
///
/// A result indicating success/failure and the value
pub async fn safe_evaluate(
    adapter: &dyn EngineAdapter,
    script: &str,
    default: serde_json::Value,
) -> SafeEvaluateResult {
    match adapter.evaluate(script).await {
        Ok(value) => SafeEvaluateResult {
            success: true,
            value,
            navigation_error: false,
        },
        Err(e) if is_navigation_error(&e.to_string()) => SafeEvaluateResult {
            success: false,
            value: default,
            navigation_error: true,
        },
        Err(_) => SafeEvaluateResult {
            success: false,
            value: default,
            navigation_error: false,
        },
    }
}

/// Result of a safe evaluate operation.
#[derive(Debug, Clone)]
pub struct SafeEvaluateResult {
    /// Whether the evaluation succeeded.
    pub success: bool,
    /// The value (actual result or default).
    pub value: serde_json::Value,
    /// Whether a navigation error occurred.
    pub navigation_error: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wait_result_completed() {
        let result = WaitResult::completed();
        assert!(result.completed);
        assert!(!result.aborted);
    }

    #[test]
    fn wait_result_aborted() {
        let result = WaitResult::aborted();
        assert!(!result.completed);
        assert!(result.aborted);
    }

    #[tokio::test]
    async fn wait_completes() {
        let start = std::time::Instant::now();
        let result = wait(Duration::from_millis(50), Some("test wait")).await;
        let elapsed = start.elapsed();

        assert!(result.completed);
        assert!(!result.aborted);
        assert!(elapsed >= Duration::from_millis(50));
    }

    #[tokio::test]
    async fn wait_with_cancel_completes_normally() {
        let token = CancellationToken::new();
        let result = wait_with_cancel(
            Duration::from_millis(10),
            &token,
            Some("test wait"),
        )
        .await;

        assert!(result.completed);
        assert!(!result.aborted);
    }

    #[tokio::test]
    async fn wait_with_cancel_aborts_on_cancel() {
        let token = CancellationToken::new();

        // Cancel immediately
        token.cancel();

        let result = wait_with_cancel(
            Duration::from_secs(10), // Long duration that would be cancelled
            &token,
            Some("test wait"),
        )
        .await;

        assert!(!result.completed);
        assert!(result.aborted);
    }

    #[tokio::test]
    async fn wait_with_cancel_aborts_during_wait() {
        let token = CancellationToken::new();
        let token_clone = token.clone();

        // Spawn task to cancel after a short delay
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(50)).await;
            token_clone.cancel();
        });

        let start = std::time::Instant::now();
        let result = wait_with_cancel(
            Duration::from_secs(10), // Long duration that should be cancelled
            &token,
            Some("test wait"),
        )
        .await;
        let elapsed = start.elapsed();

        assert!(!result.completed);
        assert!(result.aborted);
        // Should have been cancelled quickly, not after 10 seconds
        assert!(elapsed < Duration::from_secs(1));
    }

    #[test]
    fn safe_evaluate_result_success() {
        let result = SafeEvaluateResult {
            success: true,
            value: serde_json::json!(42),
            navigation_error: false,
        };
        assert!(result.success);
        assert!(!result.navigation_error);
        assert_eq!(result.value, serde_json::json!(42));
    }

    #[test]
    fn safe_evaluate_result_navigation_error() {
        let result = SafeEvaluateResult {
            success: false,
            value: serde_json::Value::Null,
            navigation_error: true,
        };
        assert!(!result.success);
        assert!(result.navigation_error);
        assert!(result.value.is_null());
    }
}
