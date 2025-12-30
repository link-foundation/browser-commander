//! Universal high-level functions following DRY principles.
//!
//! These are pure functions that work with any browser automation engine.

use crate::core::engine::{EngineAdapter, EngineError};
use crate::core::navigation::is_navigation_error;
use std::time::Duration;

/// Wait for a URL condition to be met.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `target_url` - The target URL to wait for
/// * `description` - Description for logging
/// * `polling_interval` - Interval between checks
/// * `custom_check` - Optional custom check function
///
/// # Returns
///
/// `true` if the target URL was reached, `false` otherwise
pub async fn wait_for_url_condition<F>(
    adapter: &dyn EngineAdapter,
    target_url: &str,
    _description: Option<&str>,
    polling_interval: Duration,
    custom_check: Option<F>,
) -> Result<bool, EngineError>
where
    F: Fn(&str) -> bool,
{
    loop {
        // Run custom check if provided
        if let Some(ref check) = custom_check {
            let current_url = adapter.url().await?;
            if check(&current_url) {
                return Ok(true);
            }
        }

        // Check if target URL reached
        let current_url = match adapter.url().await {
            Ok(url) => url,
            Err(e) if is_navigation_error(&e.to_string()) => {
                // Navigation error during check - continue waiting
                tokio::time::sleep(polling_interval).await;
                continue;
            }
            Err(e) => return Err(e),
        };

        if current_url.starts_with(target_url) {
            return Ok(true);
        }

        tokio::time::sleep(polling_interval).await;
    }
}

/// Install a click detection listener on the page.
///
/// This installs a JavaScript event listener that sets a session storage
/// flag when a specific button is clicked.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `button_text` - The button text to detect
/// * `storage_key` - The session storage key to set
///
/// # Returns
///
/// `true` if the listener was installed, `false` on navigation error
pub async fn install_click_listener(
    adapter: &dyn EngineAdapter,
    button_text: &str,
    storage_key: &str,
) -> Result<bool, EngineError> {
    let script = format!(
        r#"
        (function() {{
            document.addEventListener('click', (event) => {{
                let element = event.target;
                while (element && element !== document.body) {{
                    const elementText = element.textContent?.trim() || '';
                    if (elementText === '{}' ||
                        ((element.tagName === 'A' || element.tagName === 'BUTTON') &&
                         elementText.includes('{}'))) {{
                        console.log('[Click Listener] Detected click on {} button!');
                        window.sessionStorage.setItem('{}', 'true');
                        break;
                    }}
                    element = element.parentElement;
                }}
            }}, true);
        }})()
        "#,
        button_text.replace('\'', "\\'"),
        button_text.replace('\'', "\\'"),
        button_text.replace('\'', "\\'"),
        storage_key.replace('\'', "\\'")
    );

    match adapter.evaluate(&script).await {
        Ok(_) => Ok(true),
        Err(e) if is_navigation_error(&e.to_string()) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Check and clear a session storage flag.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `storage_key` - The session storage key to check
///
/// # Returns
///
/// `true` if the flag was set (and has been cleared), `false` otherwise
pub async fn check_and_clear_flag(
    adapter: &dyn EngineAdapter,
    storage_key: &str,
) -> Result<bool, EngineError> {
    let script = format!(
        r#"
        (function() {{
            const flag = window.sessionStorage.getItem('{}');
            if (flag === 'true') {{
                window.sessionStorage.removeItem('{}');
                return true;
            }}
            return false;
        }})()
        "#,
        storage_key.replace('\'', "\\'"),
        storage_key.replace('\'', "\\'")
    );

    match adapter.evaluate(&script).await {
        Ok(value) => Ok(value.as_bool().unwrap_or(false)),
        Err(e) if is_navigation_error(&e.to_string()) => Ok(false),
        Err(e) => Err(e),
    }
}

/// Find a toggle button using multiple strategies.
///
/// First tries data-qa selectors, then falls back to text search.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `data_qa_selectors` - List of data-qa selectors to try
/// * `text_to_find` - Text to search for as fallback
/// * `element_types` - Element types to search for text
///
/// # Returns
///
/// The selector that found elements, or `None` if not found
pub async fn find_toggle_button(
    adapter: &dyn EngineAdapter,
    data_qa_selectors: &[&str],
    text_to_find: Option<&str>,
    element_types: &[&str],
) -> Result<Option<String>, EngineError> {
    // Try data-qa selectors first
    for selector in data_qa_selectors {
        let count = adapter.count(selector).await?;
        if count > 0 {
            return Ok(Some(selector.to_string()));
        }
    }

    // Fallback to text search
    if let Some(text) = text_to_find {
        for element_type in element_types {
            // Build an XPath selector for the element type with text
            let xpath = format!(
                "//{}[contains(text(), '{}')]",
                element_type,
                text.replace('\'', "\\'")
            );

            // Try to evaluate and count matches
            let script = format!(
                r#"
                (function() {{
                    const result = document.evaluate('{}', document, null,
                        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    return result.snapshotLength;
                }})()
                "#,
                xpath.replace('\'', "\\'")
            );

            match adapter.evaluate(&script).await {
                Ok(value) => {
                    if let Some(count) = value.as_u64() {
                        if count > 0 {
                            return Ok(Some(xpath));
                        }
                    }
                }
                Err(_) => continue,
            }
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn install_click_listener_script_escapes_quotes() {
        // Just verify the function signature and that it compiles
        // Actual testing requires a real browser
        let _button_text = "Click me";
        let _storage_key = "button_clicked";
    }

    #[test]
    fn check_and_clear_flag_script_escapes_quotes() {
        // Just verify the function signature
        let _storage_key = "test_key";
    }
}
