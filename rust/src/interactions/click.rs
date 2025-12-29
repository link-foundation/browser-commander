//! Click operations for browser automation.
//!
//! This module provides utilities for clicking elements with
//! pre-click state capture and verification support.

use crate::core::engine::{
    ClickVerificationResult, EngineAdapter, EngineError, PreClickState,
};
use crate::core::constants::TIMING;
use crate::core::navigation::is_navigation_error;
use crate::interactions::scroll::{scroll_into_view_if_needed, ScrollBehavior, ScrollOptions};
use std::time::Duration;

/// Options for click operations.
#[derive(Debug, Clone)]
pub struct ClickOptions {
    /// Whether to scroll the element into view before clicking.
    pub scroll_into_view: bool,
    /// Scroll behavior (smooth or instant).
    pub scroll_behavior: ScrollBehavior,
    /// Wait time after scrolling.
    pub wait_after_scroll: Duration,
    /// Wait time after clicking.
    pub wait_after_click: Duration,
    /// Whether to verify the click operation.
    pub verify: bool,
    /// Timeout for the click operation.
    pub timeout: Duration,
}

impl Default for ClickOptions {
    fn default() -> Self {
        Self {
            scroll_into_view: true,
            scroll_behavior: ScrollBehavior::Smooth,
            wait_after_scroll: TIMING.default_wait_after_scroll,
            wait_after_click: Duration::from_millis(1000),
            verify: true,
            timeout: TIMING.default_timeout,
        }
    }
}

/// Result of a click operation.
#[derive(Debug, Clone)]
pub struct ClickResult {
    /// Whether the click was performed.
    pub clicked: bool,
    /// Whether the click was verified as successful.
    pub verified: bool,
    /// Whether navigation was detected.
    pub navigated: bool,
    /// The reason for the result.
    pub reason: String,
}

impl ClickResult {
    /// Create a successful click result.
    pub fn success(reason: impl Into<String>) -> Self {
        Self {
            clicked: true,
            verified: true,
            navigated: false,
            reason: reason.into(),
        }
    }

    /// Create a result indicating navigation occurred.
    pub fn navigation(reason: impl Into<String>) -> Self {
        Self {
            clicked: false,
            verified: true,
            navigated: true,
            reason: reason.into(),
        }
    }

    /// Create a failed click result.
    pub fn failed(reason: impl Into<String>) -> Self {
        Self {
            clicked: false,
            verified: false,
            navigated: false,
            reason: reason.into(),
        }
    }
}

/// Capture the pre-click state of an element for verification.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
///
/// # Returns
///
/// The pre-click state of the element
pub async fn capture_pre_click_state(
    adapter: &dyn EngineAdapter,
    selector: &str,
) -> Result<PreClickState, EngineError> {
    // Use JavaScript evaluation to capture element state
    let script = format!(
        r#"
        (function() {{
            const el = document.querySelector('{}');
            if (!el) return null;
            return {{
                disabled: el.disabled || false,
                ariaPressed: el.getAttribute('aria-pressed'),
                ariaExpanded: el.getAttribute('aria-expanded'),
                ariaSelected: el.getAttribute('aria-selected'),
                checked: el.checked || false,
                className: el.className || '',
                isConnected: el.isConnected
            }};
        }})()
        "#,
        selector.replace('\'', "\\'")
    );

    let result = adapter.evaluate(&script).await?;

    if result.is_null() {
        return Ok(PreClickState::default());
    }

    Ok(PreClickState {
        disabled: result.get("disabled").and_then(|v| v.as_bool()),
        aria_pressed: result.get("ariaPressed").and_then(|v| v.as_str()).map(String::from),
        aria_expanded: result.get("ariaExpanded").and_then(|v| v.as_str()).map(String::from),
        aria_selected: result.get("ariaSelected").and_then(|v| v.as_str()).map(String::from),
        checked: result.get("checked").and_then(|v| v.as_bool()),
        class_name: result.get("className").and_then(|v| v.as_str()).map(String::from),
        is_connected: result.get("isConnected").and_then(|v| v.as_bool()).unwrap_or(false),
    })
}

/// Verify a click operation by comparing pre and post-click states.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `pre_click_state` - The state captured before the click
///
/// # Returns
///
/// The verification result
pub async fn verify_click(
    adapter: &dyn EngineAdapter,
    selector: &str,
    pre_click_state: &PreClickState,
) -> Result<ClickVerificationResult, EngineError> {
    let post_click_state = match capture_pre_click_state(adapter, selector).await {
        Ok(state) => state,
        Err(e) if is_navigation_error(&e.to_string()) => {
            return Ok(ClickVerificationResult {
                verified: true,
                reason: "navigation detected (expected for navigation clicks)".to_string(),
                navigation_error: true,
            });
        }
        Err(e) => return Err(e),
    };

    // Check for state changes that indicate click was processed
    if pre_click_state.aria_pressed != post_click_state.aria_pressed {
        return Ok(ClickVerificationResult {
            verified: true,
            reason: "aria-pressed changed".to_string(),
            navigation_error: false,
        });
    }

    if pre_click_state.aria_expanded != post_click_state.aria_expanded {
        return Ok(ClickVerificationResult {
            verified: true,
            reason: "aria-expanded changed".to_string(),
            navigation_error: false,
        });
    }

    if pre_click_state.aria_selected != post_click_state.aria_selected {
        return Ok(ClickVerificationResult {
            verified: true,
            reason: "aria-selected changed".to_string(),
            navigation_error: false,
        });
    }

    if pre_click_state.checked != post_click_state.checked {
        return Ok(ClickVerificationResult {
            verified: true,
            reason: "checked state changed".to_string(),
            navigation_error: false,
        });
    }

    if pre_click_state.class_name != post_click_state.class_name {
        return Ok(ClickVerificationResult {
            verified: true,
            reason: "className changed".to_string(),
            navigation_error: false,
        });
    }

    // If element is still connected and not disabled, assume click worked
    if post_click_state.is_connected {
        return Ok(ClickVerificationResult {
            verified: true,
            reason: "element still connected (assumed success)".to_string(),
            navigation_error: false,
        });
    }

    // Element was removed from DOM - likely click triggered UI change
    Ok(ClickVerificationResult {
        verified: true,
        reason: "element removed from DOM (UI updated)".to_string(),
        navigation_error: false,
    })
}

/// Click an element (low-level operation).
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `options` - Click options
///
/// # Returns
///
/// The result of the click operation
pub async fn click_element(
    adapter: &dyn EngineAdapter,
    selector: &str,
    options: &ClickOptions,
) -> Result<ClickResult, EngineError> {
    // Capture pre-click state for verification
    let pre_click_state = if options.verify {
        capture_pre_click_state(adapter, selector).await?
    } else {
        PreClickState::default()
    };

    // Perform the click
    match adapter.click(selector).await {
        Ok(_) => {}
        Err(e) if is_navigation_error(&e.to_string()) => {
            return Ok(ClickResult::navigation("navigation during click"));
        }
        Err(e) => return Err(e),
    }

    // Verify click if requested
    if options.verify {
        let verification = verify_click(adapter, selector, &pre_click_state).await?;
        Ok(ClickResult {
            clicked: true,
            verified: verification.verified,
            navigated: verification.navigation_error,
            reason: verification.reason,
        })
    } else {
        Ok(ClickResult::success("click completed"))
    }
}

/// Click a button or element (high-level with scrolling and waits).
///
/// This function handles:
/// - Scrolling the element into view
/// - Clicking the element
/// - Verifying the click
/// - Waiting for any triggered navigation
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `options` - Click options
///
/// # Returns
///
/// The result of the click operation
pub async fn click_button(
    adapter: &dyn EngineAdapter,
    selector: &str,
    options: &ClickOptions,
) -> Result<ClickResult, EngineError> {
    // Scroll into view if requested
    if options.scroll_into_view {
        let scroll_options = ScrollOptions {
            behavior: options.scroll_behavior,
            wait_after_scroll: options.wait_after_scroll,
            ..Default::default()
        };

        match scroll_into_view_if_needed(adapter, selector, &scroll_options).await {
            Ok(_) => {}
            Err(e) if is_navigation_error(&e.to_string()) => {
                return Ok(ClickResult::navigation("navigation during scroll"));
            }
            Err(e) => return Err(e),
        }
    }

    // Perform the click
    let result = click_element(adapter, selector, options).await?;

    // Wait after click if specified
    if result.clicked {
        tokio::time::sleep(options.wait_after_click).await;
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn click_options_default() {
        let options = ClickOptions::default();
        assert!(options.scroll_into_view);
        assert_eq!(options.scroll_behavior, ScrollBehavior::Smooth);
        assert!(options.verify);
    }

    #[test]
    fn click_result_success() {
        let result = ClickResult::success("element clicked");
        assert!(result.clicked);
        assert!(result.verified);
        assert!(!result.navigated);
        assert_eq!(result.reason, "element clicked");
    }

    #[test]
    fn click_result_navigation() {
        let result = ClickResult::navigation("page navigated");
        assert!(!result.clicked);
        assert!(result.verified);
        assert!(result.navigated);
    }

    #[test]
    fn click_result_failed() {
        let result = ClickResult::failed("element not found");
        assert!(!result.clicked);
        assert!(!result.verified);
        assert!(!result.navigated);
    }

    #[test]
    fn pre_click_state_default() {
        let state = PreClickState::default();
        assert!(state.disabled.is_none());
        assert!(state.aria_pressed.is_none());
        assert!(!state.is_connected);
    }
}
