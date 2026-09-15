//! A scripted [`EngineAdapter`] stub for unit tests.
//!
//! Navigation and readiness tests need to control exactly what `url()`
//! answers on each call - a URL that keeps changing is what a redirect chain
//! looks like from the adapter's side. Everything else the trait requires is
//! answered with a harmless default so a test only states the part it cares
//! about.

use crate::core::engine::{ElementInfo, EngineAdapter, EngineError, EngineType, PdfOptions};
use async_trait::async_trait;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

/// An engine adapter whose `url()` answers come from a script.
pub struct StubEngine {
    url_of: Box<dyn Fn(usize) -> String + Send + Sync>,
    url_calls: AtomicUsize,
    goto_calls: Mutex<Vec<String>>,
}

impl std::fmt::Debug for StubEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StubEngine")
            .field("url_calls", &self.url_calls())
            .field("goto_calls", &self.goto_calls())
            .finish()
    }
}

impl StubEngine {
    /// Build a stub whose `url()` is computed from the call index.
    pub fn scripted(url_of: impl Fn(usize) -> String + Send + Sync + 'static) -> Self {
        Self {
            url_of: Box::new(url_of),
            url_calls: AtomicUsize::new(0),
            goto_calls: Mutex::new(Vec::new()),
        }
    }

    /// Build a stub that always reports the same URL.
    pub fn fixed(url: impl Into<String>) -> Self {
        let url = url.into();
        Self::scripted(move |_| url.clone())
    }

    /// Build a stub whose URL never repeats, i.e. a redirect that never ends.
    pub fn never_stable() -> Self {
        Self::scripted(|call| format!("https://example.com/redirect/{call}"))
    }

    /// Number of times `url()` was asked.
    pub fn url_calls(&self) -> usize {
        self.url_calls.load(Ordering::SeqCst)
    }

    /// Every URL passed to `goto()`, in order.
    pub fn goto_calls(&self) -> Vec<String> {
        self.goto_calls.lock().unwrap().clone()
    }
}

#[async_trait]
impl EngineAdapter for StubEngine {
    fn engine_type(&self) -> EngineType {
        EngineType::Chromiumoxide
    }

    async fn url(&self) -> Result<String, EngineError> {
        let call = self.url_calls.fetch_add(1, Ordering::SeqCst);
        Ok((self.url_of)(call))
    }

    async fn goto(&self, url: &str) -> Result<(), EngineError> {
        self.goto_calls.lock().unwrap().push(url.to_string());
        Ok(())
    }

    async fn query_selector(&self, _selector: &str) -> Result<Option<ElementInfo>, EngineError> {
        Ok(None)
    }

    async fn query_selector_all(&self, _selector: &str) -> Result<Vec<ElementInfo>, EngineError> {
        Ok(Vec::new())
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
        Ok(Vec::new())
    }

    async fn pdf(&self, _options: PdfOptions) -> Result<Vec<u8>, EngineError> {
        Err(EngineError::Browser(
            "PDF not supported by stub".to_string(),
        ))
    }

    async fn bring_to_front(&self) -> Result<(), EngineError> {
        Ok(())
    }

    async fn wait_for_navigation(&self, _timeout_ms: u64) -> Result<(), EngineError> {
        Ok(())
    }

    async fn keyboard_press(&self, _key: &str) -> Result<(), EngineError> {
        Ok(())
    }

    async fn keyboard_type(&self, _text: &str) -> Result<(), EngineError> {
        Ok(())
    }

    async fn keyboard_down(&self, _key: &str) -> Result<(), EngineError> {
        Ok(())
    }

    async fn keyboard_up(&self, _key: &str) -> Result<(), EngineError> {
        Ok(())
    }
}
