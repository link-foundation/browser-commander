//! CSS selector utilities.
//!
//! This module provides utilities for working with CSS selectors,
//! including parsing, normalization, and text-based selector support.

use regex::Regex;
use std::sync::LazyLock;

/// Pattern for detecting text-based selectors like `:text("Submit")`.
static TEXT_SELECTOR_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"^:text\(["'](.+?)["']\)$"#).expect("Invalid regex pattern"));

/// Pattern for detecting nth-of-type selectors.
static NTH_OF_TYPE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(.+?):nth-of-type\((\d+)\)"#).expect("Invalid regex pattern"));

/// Represents a parsed selector.
#[derive(Debug, Clone, PartialEq)]
pub enum ParsedSelector {
    /// A standard CSS selector.
    Css(String),
    /// A text-based selector.
    Text {
        text: String,
        element: Option<String>,
    },
    /// An XPath selector.
    XPath(String),
}

/// Check if a selector is a text-based selector.
///
/// Text selectors have the format `:text("text content")`.
///
/// # Arguments
///
/// * `selector` - The selector to check
///
/// # Returns
///
/// `true` if the selector is a text-based selector
pub fn is_text_selector(selector: &str) -> bool {
    TEXT_SELECTOR_PATTERN.is_match(selector)
}

/// Extract the text from a text selector.
///
/// # Arguments
///
/// * `selector` - A text selector like `:text("Submit")`
///
/// # Returns
///
/// The text content if this is a text selector, `None` otherwise
pub fn extract_text_from_selector(selector: &str) -> Option<String> {
    TEXT_SELECTOR_PATTERN
        .captures(selector)
        .map(|caps| caps[1].to_string())
}

/// Normalize a selector for consistent handling.
///
/// This function handles various selector formats and converts them
/// to a standardized form.
///
/// # Arguments
///
/// * `selector` - The selector to normalize
///
/// # Returns
///
/// The parsed selector
pub fn normalize_selector(selector: &str) -> ParsedSelector {
    let trimmed = selector.trim();

    // Check for text selector
    if let Some(text) = extract_text_from_selector(trimmed) {
        return ParsedSelector::Text {
            text,
            element: None,
        };
    }

    // Check for XPath
    if trimmed.starts_with("//") || trimmed.starts_with("(//") {
        return ParsedSelector::XPath(trimmed.to_string());
    }

    // Standard CSS selector
    ParsedSelector::Css(trimmed.to_string())
}

/// Build a CSS selector to find elements by visible text.
///
/// This creates a selector that matches elements containing the specified text.
/// Note: This is a best-effort approach and may not work for all cases.
///
/// # Arguments
///
/// * `text` - The text to search for
/// * `element_type` - Optional element type to restrict the search (e.g., "button")
///
/// # Returns
///
/// A CSS selector string (or XPath for more complex cases)
pub fn build_text_selector(text: &str, element_type: Option<&str>) -> String {
    // For simple cases, use XPath as it has better text support
    match element_type {
        Some(el) => format!("//{}[contains(text(), '{}')]", el, text),
        None => format!("//*[contains(text(), '{}')]", text),
    }
}

/// Check if a selector contains an nth-of-type modifier.
///
/// # Arguments
///
/// * `selector` - The selector to check
///
/// # Returns
///
/// `true` if the selector contains `:nth-of-type()`
pub fn has_nth_of_type(selector: &str) -> bool {
    NTH_OF_TYPE_PATTERN.is_match(selector)
}

/// Parse an nth-of-type selector into its base selector and index.
///
/// # Arguments
///
/// * `selector` - A selector like `button:nth-of-type(2)`
///
/// # Returns
///
/// A tuple of (base_selector, index) if this is an nth-of-type selector
pub fn parse_nth_of_type(selector: &str) -> Option<(String, usize)> {
    NTH_OF_TYPE_PATTERN.captures(selector).and_then(|caps| {
        let base = caps[1].to_string();
        let index = caps[2].parse::<usize>().ok()?;
        Some((base, index))
    })
}

/// Escape special characters in a CSS selector value.
///
/// # Arguments
///
/// * `value` - The value to escape
///
/// # Returns
///
/// The escaped value
pub fn escape_selector_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\'', "\\'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_text_selector_true_for_text_selectors() {
        assert!(is_text_selector(":text(\"Submit\")"));
        assert!(is_text_selector(":text('Submit')"));
        assert!(is_text_selector(":text(\"Click me\")"));
    }

    #[test]
    fn is_text_selector_false_for_css_selectors() {
        assert!(!is_text_selector("button"));
        assert!(!is_text_selector(".class"));
        assert!(!is_text_selector("#id"));
        assert!(!is_text_selector("[data-test]"));
    }

    #[test]
    fn extract_text_from_selector_extracts_text() {
        assert_eq!(
            extract_text_from_selector(":text(\"Submit\")"),
            Some("Submit".to_string())
        );
        assert_eq!(
            extract_text_from_selector(":text('Click me')"),
            Some("Click me".to_string())
        );
    }

    #[test]
    fn extract_text_from_selector_returns_none_for_css() {
        assert_eq!(extract_text_from_selector("button"), None);
        assert_eq!(extract_text_from_selector(".class"), None);
    }

    #[test]
    fn normalize_selector_handles_css() {
        assert_eq!(
            normalize_selector("button"),
            ParsedSelector::Css("button".to_string())
        );
        assert_eq!(
            normalize_selector("  .class  "),
            ParsedSelector::Css(".class".to_string())
        );
    }

    #[test]
    fn normalize_selector_handles_text() {
        assert_eq!(
            normalize_selector(":text(\"Submit\")"),
            ParsedSelector::Text {
                text: "Submit".to_string(),
                element: None
            }
        );
    }

    #[test]
    fn normalize_selector_handles_xpath() {
        assert_eq!(
            normalize_selector("//button"),
            ParsedSelector::XPath("//button".to_string())
        );
        assert_eq!(
            normalize_selector("(//div)[1]"),
            ParsedSelector::XPath("(//div)[1]".to_string())
        );
    }

    #[test]
    fn build_text_selector_without_element() {
        let selector = build_text_selector("Submit", None);
        assert!(selector.contains("Submit"));
        assert!(selector.contains("contains(text()"));
    }

    #[test]
    fn build_text_selector_with_element() {
        let selector = build_text_selector("Submit", Some("button"));
        assert!(selector.contains("button"));
        assert!(selector.contains("Submit"));
    }

    #[test]
    fn has_nth_of_type_detects_pattern() {
        assert!(has_nth_of_type("button:nth-of-type(1)"));
        assert!(has_nth_of_type("div.class:nth-of-type(2)"));
        assert!(!has_nth_of_type("button"));
        assert!(!has_nth_of_type("button:first-child"));
    }

    #[test]
    fn parse_nth_of_type_extracts_parts() {
        assert_eq!(
            parse_nth_of_type("button:nth-of-type(1)"),
            Some(("button".to_string(), 1))
        );
        assert_eq!(
            parse_nth_of_type("div.class:nth-of-type(3)"),
            Some(("div.class".to_string(), 3))
        );
        assert_eq!(parse_nth_of_type("button"), None);
    }

    #[test]
    fn escape_selector_value_escapes_special_chars() {
        assert_eq!(escape_selector_value("test"), "test");
        assert_eq!(escape_selector_value("test\"value"), "test\\\"value");
        assert_eq!(escape_selector_value("test'value"), "test\\'value");
        assert_eq!(escape_selector_value("test\\value"), "test\\\\value");
    }
}
