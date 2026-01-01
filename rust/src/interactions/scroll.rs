//! Scroll operations for browser automation.
//!
//! This module provides utilities for scrolling elements into view
//! with verification support.

use crate::core::constants::TIMING;
use crate::core::engine::{EngineAdapter, EngineError, ScrollVerificationResult};
use std::time::{Duration, Instant};

/// Scroll behavior options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ScrollBehavior {
    /// Smooth animated scrolling.
    #[default]
    Smooth,
    /// Instant scrolling (no animation).
    Instant,
}

impl std::fmt::Display for ScrollBehavior {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScrollBehavior::Smooth => write!(f, "smooth"),
            ScrollBehavior::Instant => write!(f, "instant"),
        }
    }
}

/// Options for scroll operations.
#[derive(Debug, Clone)]
pub struct ScrollOptions {
    /// The scroll behavior (smooth or instant).
    pub behavior: ScrollBehavior,
    /// Whether to verify the scroll operation.
    pub verify: bool,
    /// Timeout for verification.
    pub verification_timeout: Duration,
    /// Interval between verification retries.
    pub verification_retry_interval: Duration,
    /// Threshold percentage for determining if scroll is needed.
    pub threshold_percent: f64,
    /// Wait time after scroll for animation to complete.
    pub wait_after_scroll: Duration,
}

impl Default for ScrollOptions {
    fn default() -> Self {
        Self {
            behavior: ScrollBehavior::Smooth,
            verify: true,
            verification_timeout: TIMING.verification_timeout,
            verification_retry_interval: TIMING.verification_retry_interval,
            threshold_percent: 10.0,
            wait_after_scroll: TIMING.scroll_animation_wait,
        }
    }
}

/// Result of a scroll operation.
#[derive(Debug, Clone)]
pub struct ScrollResult {
    /// Whether scroll was performed.
    pub scrolled: bool,
    /// Whether the scroll was verified as successful.
    pub verified: bool,
    /// Whether the scroll was skipped because element was already in view.
    pub skipped: bool,
}

impl ScrollResult {
    /// Create a result indicating scroll was skipped.
    pub fn skipped() -> Self {
        Self {
            scrolled: false,
            verified: true,
            skipped: true,
        }
    }

    /// Create a result indicating scroll was performed.
    pub fn performed(verified: bool) -> Self {
        Self {
            scrolled: true,
            verified,
            skipped: false,
        }
    }

    /// Create a result indicating scroll failed (e.g., navigation occurred).
    pub fn failed() -> Self {
        Self {
            scrolled: false,
            verified: false,
            skipped: false,
        }
    }
}

/// Scroll an element into view.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `options` - Scroll options
///
/// # Returns
///
/// The result of the scroll operation
pub async fn scroll_into_view(
    adapter: &dyn EngineAdapter,
    selector: &str,
    options: &ScrollOptions,
) -> Result<ScrollResult, EngineError> {
    adapter.scroll_into_view(selector).await?;

    if options.verify {
        let verification = verify_scroll(adapter, selector, options).await?;
        Ok(ScrollResult::performed(verification.verified))
    } else {
        Ok(ScrollResult::performed(true))
    }
}

/// Verify that a scroll operation was successful.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `options` - Scroll options
///
/// # Returns
///
/// The verification result
pub async fn verify_scroll(
    adapter: &dyn EngineAdapter,
    selector: &str,
    options: &ScrollOptions,
) -> Result<ScrollVerificationResult, EngineError> {
    let start_time = Instant::now();
    let mut attempts = 0u32;

    while start_time.elapsed() < options.verification_timeout {
        attempts += 1;

        // Check if element is visible (indicating it's in viewport)
        let is_visible = adapter.is_visible(selector).await?;

        if is_visible {
            return Ok(ScrollVerificationResult {
                verified: true,
                in_viewport: true,
                attempts,
            });
        }

        tokio::time::sleep(options.verification_retry_interval).await;
    }

    Ok(ScrollVerificationResult {
        verified: false,
        in_viewport: false,
        attempts,
    })
}

/// Scroll element into view only if needed.
///
/// This function first checks if the element is already in view
/// before performing the scroll.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `options` - Scroll options
///
/// # Returns
///
/// The result of the scroll operation
pub async fn scroll_into_view_if_needed(
    adapter: &dyn EngineAdapter,
    selector: &str,
    options: &ScrollOptions,
) -> Result<ScrollResult, EngineError> {
    // Check if element is already visible
    let is_visible = adapter.is_visible(selector).await?;

    if is_visible {
        // Element is already in view, skip scrolling
        return Ok(ScrollResult::skipped());
    }

    // Perform scroll
    let result = scroll_into_view(adapter, selector, options).await?;

    // Wait for scroll animation if needed
    if result.scrolled && options.behavior == ScrollBehavior::Smooth {
        tokio::time::sleep(options.wait_after_scroll).await;
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scroll_behavior_display() {
        assert_eq!(ScrollBehavior::Smooth.to_string(), "smooth");
        assert_eq!(ScrollBehavior::Instant.to_string(), "instant");
    }

    #[test]
    fn scroll_options_default() {
        let options = ScrollOptions::default();
        assert_eq!(options.behavior, ScrollBehavior::Smooth);
        assert!(options.verify);
        assert_eq!(options.threshold_percent, 10.0);
    }

    #[test]
    fn scroll_result_skipped() {
        let result = ScrollResult::skipped();
        assert!(!result.scrolled);
        assert!(result.verified);
        assert!(result.skipped);
    }

    #[test]
    fn scroll_result_performed() {
        let result = ScrollResult::performed(true);
        assert!(result.scrolled);
        assert!(result.verified);
        assert!(!result.skipped);

        let result = ScrollResult::performed(false);
        assert!(result.scrolled);
        assert!(!result.verified);
        assert!(!result.skipped);
    }

    #[test]
    fn scroll_result_failed() {
        let result = ScrollResult::failed();
        assert!(!result.scrolled);
        assert!(!result.verified);
        assert!(!result.skipped);
    }
}
