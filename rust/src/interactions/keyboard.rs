//! Page-level keyboard interactions.
//!
//! This module provides functions for sending keyboard events at the page level,
//! independent of any specific element. This is useful for:
//! - Dismissing dialogs (`Escape`)
//! - Submitting forms (`Enter`)
//! - Tab navigation
//! - Keyboard shortcuts (e.g. `Control+A`)

use crate::core::engine::{EngineAdapter, EngineError};

/// Press a key at the page level.
///
/// Key names follow the Playwright/Puppeteer convention, e.g.:
/// `"Escape"`, `"Enter"`, `"Tab"`, `"ArrowDown"`, `"Control"`, `"Shift"`.
///
/// # Arguments
///
/// * `engine` - The browser engine adapter
/// * `key` - The key name to press
///
/// # Errors
///
/// Returns `EngineError` if the key press fails.
///
/// # Example
///
/// ```rust,no_run
/// use browser_commander::interactions::keyboard::press_key;
///
/// // press_key(&engine, "Escape").await?;
/// ```
pub async fn press_key(engine: &dyn EngineAdapter, key: &str) -> Result<(), EngineError> {
    engine.keyboard_press(key).await
}

/// Type text at the page level (dispatches key events for each character).
///
/// Unlike element-level fill/type, this sends keyboard events to whatever
/// element is currently focused on the page.
///
/// # Arguments
///
/// * `engine` - The browser engine adapter
/// * `text` - The text to type
///
/// # Errors
///
/// Returns `EngineError` if typing fails.
pub async fn type_text(engine: &dyn EngineAdapter, text: &str) -> Result<(), EngineError> {
    engine.keyboard_type(text).await
}

/// Hold a key down at the page level.
///
/// Must be paired with [`key_up`] to release the key.
///
/// # Arguments
///
/// * `engine` - The browser engine adapter
/// * `key` - The key name to hold down
///
/// # Errors
///
/// Returns `EngineError` if the key down operation fails.
pub async fn key_down(engine: &dyn EngineAdapter, key: &str) -> Result<(), EngineError> {
    engine.keyboard_down(key).await
}

/// Release a held key at the page level.
///
/// # Arguments
///
/// * `engine` - The browser engine adapter
/// * `key` - The key name to release
///
/// # Errors
///
/// Returns `EngineError` if the key up operation fails.
pub async fn key_up(engine: &dyn EngineAdapter, key: &str) -> Result<(), EngineError> {
    engine.keyboard_up(key).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::engine::{ElementInfo, EngineError, EngineType};
    use async_trait::async_trait;
    use std::sync::{Arc, Mutex};

    /// Mock engine for testing keyboard operations.
    struct MockEngine {
        pressed_keys: Arc<Mutex<Vec<String>>>,
        typed_texts: Arc<Mutex<Vec<String>>>,
        down_keys: Arc<Mutex<Vec<String>>>,
        up_keys: Arc<Mutex<Vec<String>>>,
    }

    impl MockEngine {
        fn new() -> Self {
            Self {
                pressed_keys: Arc::new(Mutex::new(vec![])),
                typed_texts: Arc::new(Mutex::new(vec![])),
                down_keys: Arc::new(Mutex::new(vec![])),
                up_keys: Arc::new(Mutex::new(vec![])),
            }
        }
    }

    #[async_trait]
    impl EngineAdapter for MockEngine {
        fn engine_type(&self) -> EngineType {
            EngineType::Fantoccini
        }

        async fn url(&self) -> Result<String, EngineError> {
            Ok("https://example.com".to_string())
        }

        async fn goto(&self, _url: &str) -> Result<(), EngineError> {
            Ok(())
        }

        async fn query_selector(
            &self,
            _selector: &str,
        ) -> Result<Option<ElementInfo>, EngineError> {
            Ok(None)
        }

        async fn query_selector_all(
            &self,
            _selector: &str,
        ) -> Result<Vec<ElementInfo>, EngineError> {
            Ok(vec![])
        }

        async fn count(&self, _selector: &str) -> Result<usize, EngineError> {
            Ok(0)
        }

        async fn click(&self, _selector: &str) -> Result<(), EngineError> {
            Ok(())
        }

        async fn fill(&self, _selector: &str, _text: &str) -> Result<(), EngineError> {
            Ok(())
        }

        async fn type_text(&self, _selector: &str, _text: &str) -> Result<(), EngineError> {
            Ok(())
        }

        async fn text_content(&self, _selector: &str) -> Result<Option<String>, EngineError> {
            Ok(None)
        }

        async fn input_value(&self, _selector: &str) -> Result<Option<String>, EngineError> {
            Ok(None)
        }

        async fn get_attribute(
            &self,
            _selector: &str,
            _attribute: &str,
        ) -> Result<Option<String>, EngineError> {
            Ok(None)
        }

        async fn is_visible(&self, _selector: &str) -> Result<bool, EngineError> {
            Ok(true)
        }

        async fn is_enabled(&self, _selector: &str) -> Result<bool, EngineError> {
            Ok(true)
        }

        async fn wait_for_selector(
            &self,
            _selector: &str,
            _timeout_ms: u64,
        ) -> Result<(), EngineError> {
            Ok(())
        }

        async fn scroll_into_view(&self, _selector: &str) -> Result<(), EngineError> {
            Ok(())
        }

        async fn evaluate(&self, _script: &str) -> Result<serde_json::Value, EngineError> {
            Ok(serde_json::Value::Null)
        }

        async fn screenshot(&self) -> Result<Vec<u8>, EngineError> {
            Ok(vec![])
        }

        async fn bring_to_front(&self) -> Result<(), EngineError> {
            Ok(())
        }

        async fn wait_for_navigation(&self, _timeout_ms: u64) -> Result<(), EngineError> {
            Ok(())
        }

        async fn keyboard_press(&self, key: &str) -> Result<(), EngineError> {
            self.pressed_keys.lock().unwrap().push(key.to_string());
            Ok(())
        }

        async fn keyboard_type(&self, text: &str) -> Result<(), EngineError> {
            self.typed_texts.lock().unwrap().push(text.to_string());
            Ok(())
        }

        async fn keyboard_down(&self, key: &str) -> Result<(), EngineError> {
            self.down_keys.lock().unwrap().push(key.to_string());
            Ok(())
        }

        async fn keyboard_up(&self, key: &str) -> Result<(), EngineError> {
            self.up_keys.lock().unwrap().push(key.to_string());
            Ok(())
        }
    }

    #[tokio::test]
    async fn test_press_key() {
        let engine = MockEngine::new();
        press_key(&engine, "Escape").await.unwrap();
        assert_eq!(
            *engine.pressed_keys.lock().unwrap(),
            vec!["Escape".to_string()]
        );
    }

    #[tokio::test]
    async fn test_type_text() {
        let engine = MockEngine::new();
        type_text(&engine, "Hello World").await.unwrap();
        assert_eq!(
            *engine.typed_texts.lock().unwrap(),
            vec!["Hello World".to_string()]
        );
    }

    #[tokio::test]
    async fn test_key_down() {
        let engine = MockEngine::new();
        key_down(&engine, "Control").await.unwrap();
        assert_eq!(
            *engine.down_keys.lock().unwrap(),
            vec!["Control".to_string()]
        );
    }

    #[tokio::test]
    async fn test_key_up() {
        let engine = MockEngine::new();
        key_up(&engine, "Control").await.unwrap();
        assert_eq!(*engine.up_keys.lock().unwrap(), vec!["Control".to_string()]);
    }

    #[tokio::test]
    async fn test_press_enter_key() {
        let engine = MockEngine::new();
        press_key(&engine, "Enter").await.unwrap();
        assert_eq!(
            *engine.pressed_keys.lock().unwrap(),
            vec!["Enter".to_string()]
        );
    }
}
