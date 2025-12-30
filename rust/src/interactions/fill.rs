//! Fill operations for browser automation.
//!
//! This module provides utilities for filling form elements
//! with verification support.

use crate::core::constants::TIMING;
use crate::core::engine::{EngineAdapter, EngineError, FillVerificationResult};
use crate::core::navigation::is_navigation_error;
use crate::elements::content::is_element_empty;
use crate::interactions::click::click_element;
use crate::interactions::scroll::{scroll_into_view_if_needed, ScrollOptions};
use std::time::{Duration, Instant};

/// Options for fill operations.
#[derive(Debug, Clone)]
pub struct FillOptions {
    /// Whether to scroll the element into view before filling.
    pub scroll_into_view: bool,
    /// Whether to simulate typing (character by character).
    pub simulate_typing: bool,
    /// Only fill if the element is empty.
    pub check_empty: bool,
    /// Whether to verify the fill operation.
    pub verify: bool,
    /// Timeout for verification.
    pub verification_timeout: Duration,
    /// Interval between verification retries.
    pub verification_retry_interval: Duration,
    /// Timeout for the overall operation.
    pub timeout: Duration,
}

impl Default for FillOptions {
    fn default() -> Self {
        Self {
            scroll_into_view: true,
            simulate_typing: true,
            check_empty: true,
            verify: true,
            verification_timeout: TIMING.verification_timeout,
            verification_retry_interval: TIMING.verification_retry_interval,
            timeout: TIMING.default_timeout,
        }
    }
}

/// Result of a fill operation.
#[derive(Debug, Clone)]
pub struct FillResult {
    /// Whether the fill was performed.
    pub filled: bool,
    /// Whether the fill was verified as successful.
    pub verified: bool,
    /// Whether the fill was skipped (element had content).
    pub skipped: bool,
    /// The actual value after filling.
    pub actual_value: Option<String>,
}

impl FillResult {
    /// Create a successful fill result.
    pub fn success(actual_value: String) -> Self {
        Self {
            filled: true,
            verified: true,
            skipped: false,
            actual_value: Some(actual_value),
        }
    }

    /// Create a result indicating fill was skipped.
    pub fn skipped(actual_value: String) -> Self {
        Self {
            filled: false,
            verified: false,
            skipped: true,
            actual_value: Some(actual_value),
        }
    }

    /// Create a failed fill result.
    pub fn failed() -> Self {
        Self {
            filled: false,
            verified: false,
            skipped: false,
            actual_value: None,
        }
    }
}

/// Verify a fill operation by checking the element's value.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `expected_text` - The expected text value
/// * `options` - Fill options
///
/// # Returns
///
/// The verification result
pub async fn verify_fill(
    adapter: &dyn EngineAdapter,
    selector: &str,
    expected_text: &str,
    options: &FillOptions,
) -> Result<FillVerificationResult, EngineError> {
    let start_time = Instant::now();
    let mut attempts = 0u32;

    while start_time.elapsed() < options.verification_timeout {
        attempts += 1;

        let actual_value = match adapter.input_value(selector).await {
            Ok(Some(value)) => value,
            Ok(None) => String::new(),
            Err(e) if is_navigation_error(&e.to_string()) => {
                return Ok(FillVerificationResult {
                    verified: false,
                    actual_value: String::new(),
                    attempts,
                });
            }
            Err(e) => return Err(e),
        };

        // Verify that the value contains the expected text
        let verified = actual_value == expected_text || actual_value.contains(expected_text);

        if verified {
            return Ok(FillVerificationResult {
                verified: true,
                actual_value,
                attempts,
            });
        }

        tokio::time::sleep(options.verification_retry_interval).await;
    }

    // Final check
    let actual_value = adapter.input_value(selector).await?.unwrap_or_default();

    Ok(FillVerificationResult {
        verified: false,
        actual_value,
        attempts,
    })
}

/// Fill an input element with text (low-level operation).
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `text` - The text to fill
/// * `options` - Fill options
///
/// # Returns
///
/// The result of the fill operation
pub async fn perform_fill(
    adapter: &dyn EngineAdapter,
    selector: &str,
    text: &str,
    options: &FillOptions,
) -> Result<FillResult, EngineError> {
    // Perform the fill operation
    if options.simulate_typing {
        match adapter.type_text(selector, text).await {
            Ok(_) => {}
            Err(e) if is_navigation_error(&e.to_string()) => {
                return Ok(FillResult::failed());
            }
            Err(e) => return Err(e),
        }
    } else {
        match adapter.fill(selector, text).await {
            Ok(_) => {}
            Err(e) if is_navigation_error(&e.to_string()) => {
                return Ok(FillResult::failed());
            }
            Err(e) => return Err(e),
        }
    }

    // Verify if requested
    if options.verify {
        let verification = verify_fill(adapter, selector, text, options).await?;
        Ok(FillResult {
            filled: true,
            verified: verification.verified,
            skipped: false,
            actual_value: Some(verification.actual_value),
        })
    } else {
        Ok(FillResult {
            filled: true,
            verified: true,
            skipped: false,
            actual_value: None,
        })
    }
}

/// Fill a text area with text (high-level with checks and scrolling).
///
/// This function handles:
/// - Checking if the element is empty (if requested)
/// - Scrolling the element into view
/// - Clicking to focus
/// - Filling the text
/// - Verifying the fill
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `text` - The text to fill
/// * `options` - Fill options
///
/// # Returns
///
/// The result of the fill operation
pub async fn fill_text_area(
    adapter: &dyn EngineAdapter,
    selector: &str,
    text: &str,
    options: &FillOptions,
) -> Result<FillResult, EngineError> {
    // Check if empty (if requested)
    if options.check_empty {
        let is_empty = is_element_empty(adapter, selector).await?;
        if !is_empty {
            let current_value = adapter.input_value(selector).await?.unwrap_or_default();
            return Ok(FillResult::skipped(current_value));
        }
    }

    // Scroll into view if requested
    if options.scroll_into_view {
        let scroll_options = ScrollOptions::default();
        match scroll_into_view_if_needed(adapter, selector, &scroll_options).await {
            Ok(_) => {}
            Err(e) if is_navigation_error(&e.to_string()) => {
                return Ok(FillResult::failed());
            }
            Err(e) => return Err(e),
        }
    }

    // Click to focus
    let click_options = crate::interactions::click::ClickOptions {
        scroll_into_view: false, // Already scrolled
        verify: false,           // Don't need to verify the focus click
        ..Default::default()
    };

    match click_element(adapter, selector, &click_options).await {
        Ok(_) => {}
        Err(e) if is_navigation_error(&e.to_string()) => {
            return Ok(FillResult::failed());
        }
        Err(e) => return Err(e),
    }

    // Perform the fill
    perform_fill(adapter, selector, text, options).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fill_options_default() {
        let options = FillOptions::default();
        assert!(options.scroll_into_view);
        assert!(options.simulate_typing);
        assert!(options.check_empty);
        assert!(options.verify);
    }

    #[test]
    fn fill_result_success() {
        let result = FillResult::success("filled text".to_string());
        assert!(result.filled);
        assert!(result.verified);
        assert!(!result.skipped);
        assert_eq!(result.actual_value, Some("filled text".to_string()));
    }

    #[test]
    fn fill_result_skipped() {
        let result = FillResult::skipped("existing text".to_string());
        assert!(!result.filled);
        assert!(!result.verified);
        assert!(result.skipped);
        assert_eq!(result.actual_value, Some("existing text".to_string()));
    }

    #[test]
    fn fill_result_failed() {
        let result = FillResult::failed();
        assert!(!result.filled);
        assert!(!result.verified);
        assert!(!result.skipped);
        assert!(result.actual_value.is_none());
    }
}
