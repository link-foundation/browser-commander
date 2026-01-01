//! URL utilities for browser automation.
//!
//! This module provides utilities for working with URLs.

use crate::core::engine::{EngineAdapter, EngineError};

/// Get the current URL from the page.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
///
/// # Returns
///
/// The current URL
pub async fn get_url(adapter: &dyn EngineAdapter) -> Result<String, EngineError> {
    adapter.url().await
}

/// Unfocus the address bar (useful after browser launch).
///
/// This helps prevent accidental typing into the address bar.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
///
/// # Returns
///
/// Ok if successful (errors are silently ignored as this is a UX improvement)
pub async fn unfocus_address_bar(adapter: &dyn EngineAdapter) -> Result<(), EngineError> {
    // Bring page to front - this removes focus from address bar
    match adapter.bring_to_front().await {
        Ok(_) => Ok(()),
        Err(_) => Ok(()), // Ignore errors - this is just a UX improvement
    }
}

/// Parse and normalize a URL.
///
/// # Arguments
///
/// * `url_str` - The URL string to parse
///
/// # Returns
///
/// The parsed URL or an error
pub fn parse_url(url_str: &str) -> Result<url::Url, url::ParseError> {
    url::Url::parse(url_str)
}

/// Check if two URLs are the same origin.
///
/// # Arguments
///
/// * `url1` - First URL
/// * `url2` - Second URL
///
/// # Returns
///
/// `true` if both URLs have the same origin
pub fn same_origin(url1: &str, url2: &str) -> bool {
    match (parse_url(url1), parse_url(url2)) {
        (Ok(u1), Ok(u2)) => u1.origin() == u2.origin(),
        _ => false,
    }
}

/// Extract the domain from a URL.
///
/// # Arguments
///
/// * `url_str` - The URL string
///
/// # Returns
///
/// The domain/host if available
pub fn get_domain(url_str: &str) -> Option<String> {
    parse_url(url_str)
        .ok()
        .and_then(|u| u.host_str().map(String::from))
}

/// Check if a URL is a data URL.
///
/// # Arguments
///
/// * `url_str` - The URL string
///
/// # Returns
///
/// `true` if this is a data URL
pub fn is_data_url(url_str: &str) -> bool {
    url_str.starts_with("data:")
}

/// Check if a URL is a blob URL.
///
/// # Arguments
///
/// * `url_str` - The URL string
///
/// # Returns
///
/// `true` if this is a blob URL
pub fn is_blob_url(url_str: &str) -> bool {
    url_str.starts_with("blob:")
}

/// Check if a URL is an about: URL.
///
/// # Arguments
///
/// * `url_str` - The URL string
///
/// # Returns
///
/// `true` if this is an about: URL
pub fn is_about_url(url_str: &str) -> bool {
    url_str.starts_with("about:")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_url_valid() {
        let url = parse_url("https://example.com/path?query=value").unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("example.com"));
        assert_eq!(url.path(), "/path");
        assert_eq!(url.query(), Some("query=value"));
    }

    #[test]
    fn parse_url_invalid() {
        let result = parse_url("not a url");
        assert!(result.is_err());
    }

    #[test]
    fn same_origin_true() {
        assert!(same_origin(
            "https://example.com/page1",
            "https://example.com/page2"
        ));
        assert!(same_origin(
            "https://example.com:443/path",
            "https://example.com/"
        ));
    }

    #[test]
    fn same_origin_false() {
        assert!(!same_origin("https://example.com/", "https://other.com/"));
        assert!(!same_origin("https://example.com/", "http://example.com/"));
        assert!(!same_origin(
            "https://example.com/",
            "https://sub.example.com/"
        ));
    }

    #[test]
    fn get_domain_valid() {
        assert_eq!(
            get_domain("https://example.com/path"),
            Some("example.com".to_string())
        );
        assert_eq!(
            get_domain("https://sub.example.com/"),
            Some("sub.example.com".to_string())
        );
    }

    #[test]
    fn get_domain_invalid() {
        assert_eq!(get_domain("not a url"), None);
        assert_eq!(get_domain("data:text/plain,hello"), None);
    }

    #[test]
    fn is_data_url_true() {
        assert!(is_data_url("data:text/plain,hello"));
        assert!(is_data_url("data:image/png;base64,abc123"));
    }

    #[test]
    fn is_data_url_false() {
        assert!(!is_data_url("https://example.com"));
        assert!(!is_data_url("blob:https://example.com/abc"));
    }

    #[test]
    fn is_blob_url_true() {
        assert!(is_blob_url("blob:https://example.com/abc-123"));
    }

    #[test]
    fn is_blob_url_false() {
        assert!(!is_blob_url("https://example.com"));
        assert!(!is_blob_url("data:text/plain,hello"));
    }

    #[test]
    fn is_about_url_true() {
        assert!(is_about_url("about:blank"));
        assert!(is_about_url("about:srcdoc"));
    }

    #[test]
    fn is_about_url_false() {
        assert!(!is_about_url("https://example.com"));
        assert!(!is_about_url("data:text/plain,hello"));
    }
}
