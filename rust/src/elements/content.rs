//! Element content utilities.
//!
//! This module provides utilities for extracting content from DOM elements.

use crate::core::engine::{EngineAdapter, EngineError};

/// Get the text content of an element.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
///
/// # Returns
///
/// The text content of the element, or `None` if not found
pub async fn text_content(
    adapter: &dyn EngineAdapter,
    selector: &str,
) -> Result<Option<String>, EngineError> {
    adapter.text_content(selector).await
}

/// Get the value of an input element.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the input element
///
/// # Returns
///
/// The input value, or `None` if not found
pub async fn input_value(
    adapter: &dyn EngineAdapter,
    selector: &str,
) -> Result<Option<String>, EngineError> {
    adapter.input_value(selector).await
}

/// Get an attribute value from an element.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `attribute` - The attribute name
///
/// # Returns
///
/// The attribute value, or `None` if not found
pub async fn get_attribute(
    adapter: &dyn EngineAdapter,
    selector: &str,
    attribute: &str,
) -> Result<Option<String>, EngineError> {
    adapter.get_attribute(selector, attribute).await
}

/// Check if an input element is empty.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the input element
///
/// # Returns
///
/// `true` if the element is empty or has only whitespace
pub async fn is_element_empty(
    adapter: &dyn EngineAdapter,
    selector: &str,
) -> Result<bool, EngineError> {
    let value = adapter.input_value(selector).await?;
    Ok(value.map_or(true, |v| v.trim().is_empty()))
}

/// Information about an element for logging purposes.
#[derive(Debug, Clone)]
pub struct ElementLogInfo {
    /// The element's tag name.
    pub tag_name: String,
    /// The element's text content (truncated).
    pub text_preview: String,
    /// Key attributes for identification.
    pub attributes: Vec<(String, String)>,
}

impl std::fmt::Display for ElementLogInfo {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "<{}", self.tag_name)?;

        for (name, value) in &self.attributes {
            if !value.is_empty() {
                write!(f, " {}=\"{}\"", name, value)?;
            }
        }

        write!(f, ">")?;

        if !self.text_preview.is_empty() {
            write!(f, "{}", self.text_preview)?;
        }

        write!(f, "</{}>", self.tag_name)
    }
}

/// Truncate a string for preview purposes.
///
/// # Arguments
///
/// * `s` - The string to truncate
/// * `max_len` - Maximum length
///
/// # Returns
///
/// The truncated string with "..." if it was truncated
pub fn truncate_for_preview(s: &str, max_len: usize) -> String {
    let trimmed = s.trim();
    if trimmed.len() <= max_len {
        trimmed.to_string()
    } else {
        format!("{}...", &trimmed[..max_len])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_for_preview_short_string() {
        assert_eq!(truncate_for_preview("hello", 10), "hello");
    }

    #[test]
    fn truncate_for_preview_long_string() {
        assert_eq!(truncate_for_preview("hello world", 5), "hello...");
    }

    #[test]
    fn truncate_for_preview_trims_whitespace() {
        assert_eq!(truncate_for_preview("  hello  ", 10), "hello");
    }

    #[test]
    fn truncate_for_preview_exact_length() {
        assert_eq!(truncate_for_preview("hello", 5), "hello");
    }

    #[test]
    fn element_log_info_display() {
        let info = ElementLogInfo {
            tag_name: "button".to_string(),
            text_preview: "Click me".to_string(),
            attributes: vec![
                ("id".to_string(), "submit-btn".to_string()),
                ("class".to_string(), "primary".to_string()),
            ],
        };

        let display = format!("{}", info);
        assert!(display.contains("button"));
        assert!(display.contains("submit-btn"));
        assert!(display.contains("Click me"));
    }

    #[test]
    fn element_log_info_display_no_text() {
        let info = ElementLogInfo {
            tag_name: "input".to_string(),
            text_preview: String::new(),
            attributes: vec![("type".to_string(), "text".to_string())],
        };

        let display = format!("{}", info);
        assert!(display.contains("input"));
        assert!(display.contains("type"));
        assert!(display.contains("text"));
    }

    #[test]
    fn element_log_info_display_empty_attribute() {
        let info = ElementLogInfo {
            tag_name: "div".to_string(),
            text_preview: "content".to_string(),
            attributes: vec![
                ("id".to_string(), "test".to_string()),
                ("class".to_string(), String::new()),
            ],
        };

        let display = format!("{}", info);
        assert!(display.contains("id=\"test\""));
        // Empty class should not be displayed
        assert!(!display.contains("class="));
    }
}
