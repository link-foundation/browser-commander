//! Navigation operations for browser automation.
//!
//! This module provides high-level navigation utilities with
//! verification and stabilization support.

use crate::core::constants::TIMING;
use crate::core::engine::{EngineAdapter, EngineError};
use crate::core::navigation::is_navigation_error;
use std::time::{Duration, Instant};

/// Options for navigation operations.
#[derive(Debug, Clone)]
pub struct NavigationOptions {
    /// Wait until condition for navigation.
    pub wait_until: WaitUntil,
    /// Navigation timeout.
    pub timeout: Duration,
    /// Whether to wait for URL to stabilize before navigation.
    pub wait_for_stable_url_before: bool,
    /// Whether to wait for URL to stabilize after navigation.
    pub wait_for_stable_url_after: bool,
    /// Whether to verify the navigation.
    pub verify: bool,
    /// Verification timeout.
    pub verification_timeout: Duration,
    /// Number of consecutive stable checks required.
    pub stable_checks: u32,
    /// Interval between stability checks.
    pub check_interval: Duration,
}

impl Default for NavigationOptions {
    fn default() -> Self {
        Self {
            wait_until: WaitUntil::DomContentLoaded,
            timeout: TIMING.navigation_timeout,
            wait_for_stable_url_before: true,
            wait_for_stable_url_after: true,
            verify: true,
            verification_timeout: TIMING.verification_timeout,
            stable_checks: 3,
            check_interval: Duration::from_secs(1),
        }
    }
}

/// Wait until conditions for page load.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WaitUntil {
    /// Wait for DOMContentLoaded event.
    #[default]
    DomContentLoaded,
    /// Wait for load event.
    Load,
    /// Wait for network to be idle.
    NetworkIdle,
}

impl std::fmt::Display for WaitUntil {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WaitUntil::DomContentLoaded => write!(f, "domcontentloaded"),
            WaitUntil::Load => write!(f, "load"),
            WaitUntil::NetworkIdle => write!(f, "networkidle"),
        }
    }
}

/// Result of a navigation verification.
#[derive(Debug, Clone)]
pub struct NavigationVerificationResult {
    /// Whether the navigation was verified as successful.
    pub verified: bool,
    /// The actual URL after navigation.
    pub actual_url: String,
    /// The reason for the verification result.
    pub reason: String,
    /// Number of verification attempts.
    pub attempts: u32,
}

/// Result of a navigation operation.
#[derive(Debug, Clone)]
pub struct NavigationResult {
    /// Whether navigation was performed.
    pub navigated: bool,
    /// Whether the navigation was verified as successful.
    pub verified: bool,
    /// The actual URL after navigation.
    pub actual_url: Option<String>,
    /// The reason for the result.
    pub reason: Option<String>,
}

impl NavigationResult {
    /// Create a successful navigation result.
    pub fn success(actual_url: String) -> Self {
        Self {
            navigated: true,
            verified: true,
            actual_url: Some(actual_url),
            reason: Some("navigation completed".to_string()),
        }
    }

    /// Create a result indicating navigation was interrupted.
    pub fn interrupted(reason: impl Into<String>) -> Self {
        Self {
            navigated: false,
            verified: false,
            actual_url: None,
            reason: Some(reason.into()),
        }
    }
}

/// Verify that navigation completed successfully.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `expected_url` - The expected URL (optional, for pattern matching)
/// * `start_url` - The URL before navigation
/// * `options` - Navigation options
///
/// # Returns
///
/// The verification result
pub async fn verify_navigation(
    adapter: &dyn EngineAdapter,
    expected_url: Option<&str>,
    start_url: &str,
    options: &NavigationOptions,
) -> Result<NavigationVerificationResult, EngineError> {
    let start_time = Instant::now();
    let mut attempts = 0u32;

    while start_time.elapsed() < options.verification_timeout {
        attempts += 1;

        let actual_url = match adapter.url().await {
            Ok(url) => url,
            Err(e) if is_navigation_error(&e.to_string()) => {
                return Ok(NavigationVerificationResult {
                    verified: false,
                    actual_url: String::new(),
                    reason: "error during verification".to_string(),
                    attempts,
                });
            }
            Err(e) => return Err(e),
        };

        // If expected URL is provided, verify it matches
        if let Some(expected) = expected_url {
            if actual_url == expected {
                return Ok(NavigationVerificationResult {
                    verified: true,
                    actual_url,
                    reason: "exact URL match".to_string(),
                    attempts,
                });
            }

            if actual_url.contains(expected) || actual_url.starts_with(expected) {
                return Ok(NavigationVerificationResult {
                    verified: true,
                    actual_url,
                    reason: "URL pattern match".to_string(),
                    attempts,
                });
            }
        } else {
            // No expected URL - just verify URL changed from start
            if actual_url != start_url {
                return Ok(NavigationVerificationResult {
                    verified: true,
                    actual_url,
                    reason: "URL changed from start".to_string(),
                    attempts,
                });
            }
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    // Final check
    let actual_url = adapter.url().await?;

    Ok(NavigationVerificationResult {
        verified: false,
        actual_url: actual_url.clone(),
        reason: format!(
            "URL mismatch: expected {:?}, got \"{}\"",
            expected_url, actual_url
        ),
        attempts,
    })
}

/// Wait for URL to stabilize (no more redirects).
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `options` - Navigation options
/// * `reason` - Reason for stabilization (for logging)
///
/// # Returns
///
/// `true` if stabilized, `false` if timeout
pub async fn wait_for_url_stabilization(
    adapter: &dyn EngineAdapter,
    options: &NavigationOptions,
    _reason: &str,
) -> Result<bool, EngineError> {
    let start_time = Instant::now();
    let mut stable_count = 0u32;
    let mut last_url = adapter.url().await?;

    while stable_count < options.stable_checks {
        // Check timeout
        if start_time.elapsed() > options.timeout {
            return Ok(false);
        }

        tokio::time::sleep(options.check_interval).await;

        let current_url = adapter.url().await?;

        if current_url == last_url {
            stable_count += 1;
        } else {
            stable_count = 0;
            last_url = current_url;
        }
    }

    Ok(true)
}

/// Navigate to a URL.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `url` - The URL to navigate to
/// * `options` - Navigation options
///
/// # Returns
///
/// The result of the navigation
pub async fn goto(
    adapter: &dyn EngineAdapter,
    url: &str,
    options: &NavigationOptions,
) -> Result<NavigationResult, EngineError> {
    let start_url = adapter.url().await?;

    // Wait for URL to stabilize before navigation (if requested)
    if options.wait_for_stable_url_before {
        wait_for_url_stabilization(adapter, options, "before navigation").await?;
    }

    // Perform navigation
    match adapter.goto(url).await {
        Ok(_) => {}
        Err(e) if is_navigation_error(&e.to_string()) => {
            return Ok(NavigationResult::interrupted("navigation was interrupted"));
        }
        Err(e) => return Err(e),
    }

    // Wait for URL to stabilize after navigation (if requested)
    if options.wait_for_stable_url_after {
        wait_for_url_stabilization(adapter, options, "after navigation").await?;
    }

    // Verify navigation if requested
    if options.verify {
        let verification = verify_navigation(adapter, Some(url), &start_url, options).await?;

        return Ok(NavigationResult {
            navigated: true,
            verified: verification.verified,
            actual_url: Some(verification.actual_url),
            reason: Some(verification.reason),
        });
    }

    let actual_url = adapter.url().await?;
    Ok(NavigationResult::success(actual_url))
}

/// Wait for navigation to complete.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `timeout_ms` - Timeout in milliseconds
///
/// # Returns
///
/// `true` if navigation completed, `false` on timeout or error
pub async fn wait_for_navigation(
    adapter: &dyn EngineAdapter,
    timeout_ms: u64,
) -> Result<bool, EngineError> {
    match adapter.wait_for_navigation(timeout_ms).await {
        Ok(_) => Ok(true),
        Err(e) if is_navigation_error(&e.to_string()) => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn navigation_options_default() {
        let options = NavigationOptions::default();
        assert_eq!(options.wait_until, WaitUntil::DomContentLoaded);
        assert!(options.wait_for_stable_url_before);
        assert!(options.wait_for_stable_url_after);
        assert!(options.verify);
        assert_eq!(options.stable_checks, 3);
    }

    #[test]
    fn wait_until_display() {
        assert_eq!(WaitUntil::DomContentLoaded.to_string(), "domcontentloaded");
        assert_eq!(WaitUntil::Load.to_string(), "load");
        assert_eq!(WaitUntil::NetworkIdle.to_string(), "networkidle");
    }

    #[test]
    fn navigation_result_success() {
        let result = NavigationResult::success("https://example.com".to_string());
        assert!(result.navigated);
        assert!(result.verified);
        assert_eq!(result.actual_url, Some("https://example.com".to_string()));
    }

    #[test]
    fn navigation_result_interrupted() {
        let result = NavigationResult::interrupted("page was closed");
        assert!(!result.navigated);
        assert!(!result.verified);
        assert!(result.actual_url.is_none());
        assert_eq!(result.reason, Some("page was closed".to_string()));
    }
}
