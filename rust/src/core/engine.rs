//! Browser engine detection and abstraction.
//!
//! This module provides traits and types for abstracting over different
//! browser automation engines (currently focused on Chromium-based browsers).

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// The type of browser automation engine being used.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineType {
    /// Chrome DevTools Protocol based engine (similar to Puppeteer)
    Chromiumoxide,
    /// WebDriver-based engine (similar to Playwright's approach)
    Fantoccini,
}

impl std::fmt::Display for EngineType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineType::Chromiumoxide => write!(f, "chromiumoxide"),
            EngineType::Fantoccini => write!(f, "fantoccini"),
        }
    }
}

impl std::str::FromStr for EngineType {
    type Err = EngineError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "chromiumoxide" | "cdp" | "puppeteer" => Ok(EngineType::Chromiumoxide),
            "fantoccini" | "webdriver" | "playwright" => Ok(EngineType::Fantoccini),
            _ => Err(EngineError::InvalidEngine(s.to_string())),
        }
    }
}

/// Errors related to browser engine operations.
#[derive(Debug, Error)]
pub enum EngineError {
    /// Invalid engine type specified.
    #[error("Invalid engine: {0}. Expected 'chromiumoxide' or 'fantoccini'")]
    InvalidEngine(String),

    /// Element not found.
    #[error("Element not found: {0}")]
    ElementNotFound(String),

    /// Operation timed out.
    #[error("Operation timed out: {0}")]
    Timeout(String),

    /// Navigation error.
    #[error("Navigation error: {0}")]
    Navigation(String),

    /// JavaScript evaluation error.
    #[error("JavaScript evaluation error: {0}")]
    Evaluation(String),

    /// Generic browser error.
    #[error("Browser error: {0}")]
    Browser(String),
}

/// Result of an element query.
#[derive(Debug, Clone)]
pub struct ElementInfo {
    /// The element's tag name.
    pub tag_name: String,
    /// The element's text content.
    pub text_content: Option<String>,
    /// Whether the element is visible.
    pub is_visible: bool,
    /// Whether the element is enabled (for form elements).
    pub is_enabled: bool,
    /// The element's bounding box (x, y, width, height).
    pub bounding_box: Option<(f64, f64, f64, f64)>,
}

/// Result of a click verification.
#[derive(Debug, Clone)]
pub struct ClickVerificationResult {
    /// Whether the click was verified as successful.
    pub verified: bool,
    /// The reason for the verification result.
    pub reason: String,
    /// Whether a navigation error occurred during verification.
    pub navigation_error: bool,
}

/// Result of a scroll verification.
#[derive(Debug, Clone)]
pub struct ScrollVerificationResult {
    /// Whether the scroll was verified as successful.
    pub verified: bool,
    /// Whether the element is in the viewport.
    pub in_viewport: bool,
    /// Number of verification attempts.
    pub attempts: u32,
}

/// Result of a fill verification.
#[derive(Debug, Clone)]
pub struct FillVerificationResult {
    /// Whether the fill was verified as successful.
    pub verified: bool,
    /// The actual value in the element after filling.
    pub actual_value: String,
    /// Number of verification attempts.
    pub attempts: u32,
}

/// Pre-click state captured for verification.
#[derive(Debug, Clone, Default)]
pub struct PreClickState {
    /// Whether the element was disabled.
    pub disabled: Option<bool>,
    /// The aria-pressed attribute value.
    pub aria_pressed: Option<String>,
    /// The aria-expanded attribute value.
    pub aria_expanded: Option<String>,
    /// The aria-selected attribute value.
    pub aria_selected: Option<String>,
    /// Whether the element was checked (for checkboxes).
    pub checked: Option<bool>,
    /// The element's class name.
    pub class_name: Option<String>,
    /// Whether the element is connected to the DOM.
    pub is_connected: bool,
}

/// Trait for browser engine adapters.
///
/// This trait provides a unified interface for different browser automation
/// engines, allowing the library to work with multiple backends.
#[async_trait]
pub trait EngineAdapter: Send + Sync {
    /// Get the engine type.
    fn engine_type(&self) -> EngineType;

    /// Get the current page URL.
    async fn url(&self) -> Result<String, EngineError>;

    /// Navigate to a URL.
    async fn goto(&self, url: &str) -> Result<(), EngineError>;

    /// Query for a single element.
    async fn query_selector(&self, selector: &str) -> Result<Option<ElementInfo>, EngineError>;

    /// Query for all matching elements.
    async fn query_selector_all(&self, selector: &str) -> Result<Vec<ElementInfo>, EngineError>;

    /// Count matching elements.
    async fn count(&self, selector: &str) -> Result<usize, EngineError>;

    /// Click an element.
    async fn click(&self, selector: &str) -> Result<(), EngineError>;

    /// Fill an input element with text.
    async fn fill(&self, selector: &str, text: &str) -> Result<(), EngineError>;

    /// Type text into an element (simulating key presses).
    async fn type_text(&self, selector: &str, text: &str) -> Result<(), EngineError>;

    /// Get the text content of an element.
    async fn text_content(&self, selector: &str) -> Result<Option<String>, EngineError>;

    /// Get the value of an input element.
    async fn input_value(&self, selector: &str) -> Result<Option<String>, EngineError>;

    /// Get an attribute value from an element.
    async fn get_attribute(
        &self,
        selector: &str,
        attribute: &str,
    ) -> Result<Option<String>, EngineError>;

    /// Check if an element is visible.
    async fn is_visible(&self, selector: &str) -> Result<bool, EngineError>;

    /// Check if an element is enabled.
    async fn is_enabled(&self, selector: &str) -> Result<bool, EngineError>;

    /// Wait for a selector to appear.
    async fn wait_for_selector(
        &self,
        selector: &str,
        timeout_ms: u64,
    ) -> Result<(), EngineError>;

    /// Scroll an element into view.
    async fn scroll_into_view(&self, selector: &str) -> Result<(), EngineError>;

    /// Evaluate JavaScript in the page context.
    async fn evaluate(&self, script: &str) -> Result<serde_json::Value, EngineError>;

    /// Take a screenshot.
    async fn screenshot(&self) -> Result<Vec<u8>, EngineError>;

    /// Bring the page to front.
    async fn bring_to_front(&self) -> Result<(), EngineError>;

    /// Wait for navigation to complete.
    async fn wait_for_navigation(&self, timeout_ms: u64) -> Result<(), EngineError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_type_display() {
        assert_eq!(EngineType::Chromiumoxide.to_string(), "chromiumoxide");
        assert_eq!(EngineType::Fantoccini.to_string(), "fantoccini");
    }

    #[test]
    fn engine_type_from_str() {
        assert_eq!(
            "chromiumoxide".parse::<EngineType>().unwrap(),
            EngineType::Chromiumoxide
        );
        assert_eq!(
            "cdp".parse::<EngineType>().unwrap(),
            EngineType::Chromiumoxide
        );
        assert_eq!(
            "puppeteer".parse::<EngineType>().unwrap(),
            EngineType::Chromiumoxide
        );
        assert_eq!(
            "fantoccini".parse::<EngineType>().unwrap(),
            EngineType::Fantoccini
        );
        assert_eq!(
            "webdriver".parse::<EngineType>().unwrap(),
            EngineType::Fantoccini
        );
        assert_eq!(
            "playwright".parse::<EngineType>().unwrap(),
            EngineType::Fantoccini
        );
    }

    #[test]
    fn engine_type_from_str_case_insensitive() {
        assert_eq!(
            "CHROMIUMOXIDE".parse::<EngineType>().unwrap(),
            EngineType::Chromiumoxide
        );
        assert_eq!(
            "Fantoccini".parse::<EngineType>().unwrap(),
            EngineType::Fantoccini
        );
    }

    #[test]
    fn engine_type_from_str_invalid() {
        let result = "invalid".parse::<EngineType>();
        assert!(result.is_err());
        if let Err(EngineError::InvalidEngine(name)) = result {
            assert_eq!(name, "invalid");
        } else {
            panic!("Expected InvalidEngine error");
        }
    }

    #[test]
    fn pre_click_state_default() {
        let state = PreClickState::default();
        assert!(state.disabled.is_none());
        assert!(state.aria_pressed.is_none());
        assert!(!state.is_connected);
    }

    #[test]
    fn click_verification_result_creation() {
        let result = ClickVerificationResult {
            verified: true,
            reason: "element state changed".to_string(),
            navigation_error: false,
        };
        assert!(result.verified);
        assert!(!result.navigation_error);
    }
}
