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
use std::time::Duration;

/// How long a scripted `evaluate()` waits before answering, by call index and
/// script text.
type EvaluateDelay = Box<dyn Fn(usize, &str) -> Duration + Send + Sync>;

/// Typed captures a stub answers as a named engine would (issue #180).
struct Capture {
    engine: EngineType,
    view_fails: bool,
    calls: Mutex<Vec<crate::capture::ScreenshotOptions>>,
}

/// An engine adapter whose `url()` and `evaluate()` answers come from a script.
pub struct StubEngine {
    capture: Option<Capture>,
    url_of: Box<dyn Fn(usize) -> String + Send + Sync>,
    url_calls: AtomicUsize,
    goto_calls: Mutex<Vec<String>>,
    goto_delay: Duration,
    evaluate_of: Box<dyn Fn(usize) -> serde_json::Value + Send + Sync>,
    evaluate_calls: AtomicUsize,
    evaluate_delay_of: EvaluateDelay,
}

impl std::fmt::Debug for StubEngine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StubEngine")
            .field("url_calls", &self.url_calls())
            .field("evaluate_calls", &self.evaluate_calls())
            .field("goto_calls", &self.goto_calls())
            .finish()
    }
}

impl StubEngine {
    /// Build a stub whose `url()` is computed from the call index.
    pub fn scripted(url_of: impl Fn(usize) -> String + Send + Sync + 'static) -> Self {
        Self {
            capture: None,
            url_of: Box::new(url_of),
            url_calls: AtomicUsize::new(0),
            goto_calls: Mutex::new(Vec::new()),
            goto_delay: Duration::ZERO,
            evaluate_of: Box::new(|_| serde_json::Value::Null),
            evaluate_calls: AtomicUsize::new(0),
            evaluate_delay_of: Box::new(|_, _| Duration::ZERO),
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

    /// Answer `evaluate()` from the call index instead of with null.
    #[must_use]
    pub fn evaluating(
        mut self,
        evaluate_of: impl Fn(usize) -> serde_json::Value + Send + Sync + 'static,
    ) -> Self {
        self.evaluate_of = Box::new(evaluate_of);
        self
    }

    /// Delay each `evaluate()` answer by a scripted amount.
    ///
    /// A probe that takes far longer than the caller's budget is what a real
    /// engine does after a navigation: Playwright waits out its own 30 second
    /// locator timeout rather than failing.
    #[must_use]
    pub fn evaluating_slowly(
        mut self,
        delay_of: impl Fn(usize, &str) -> Duration + Send + Sync + 'static,
    ) -> Self {
        self.evaluate_delay_of = Box::new(delay_of);
        self
    }

    /// Simulate a finite engine navigation stall.
    pub fn navigating_slowly(mut self, delay: Duration) -> Self {
        self.goto_delay = delay;
        self
    }

    /// Claim to be `engine` and record typed captures: a stable view capture
    /// answers `b"view"`, or fails as a page without CDP does.
    #[must_use]
    pub fn capturing_as(mut self, engine: EngineType, view_fails: bool) -> Self {
        self.capture = Some(Capture {
            engine,
            view_fails,
            calls: Mutex::new(Vec::new()),
        });
        self
    }

    /// Every typed capture asked of a [`Self::capturing_as`] stub, in order.
    pub fn captures(&self) -> Vec<crate::capture::ScreenshotOptions> {
        self.capture
            .as_ref()
            .map_or_else(Vec::new, |capture| capture.calls.lock().unwrap().clone())
    }

    /// Number of times `evaluate()` was asked.
    pub fn evaluate_calls(&self) -> usize {
        self.evaluate_calls.load(Ordering::SeqCst)
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
        self.capture
            .as_ref()
            .map_or(EngineType::Chromiumoxide, |capture| capture.engine)
    }

    async fn url(&self) -> Result<String, EngineError> {
        let call = self.url_calls.fetch_add(1, Ordering::SeqCst);
        Ok((self.url_of)(call))
    }

    async fn goto(&self, url: &str) -> Result<(), EngineError> {
        self.goto_calls.lock().unwrap().push(url.to_string());
        tokio::time::sleep(self.goto_delay).await;
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

    async fn evaluate(&self, script: &str) -> Result<serde_json::Value, EngineError> {
        let call = self.evaluate_calls.fetch_add(1, Ordering::SeqCst);
        let delay = (self.evaluate_delay_of)(call, script);
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        Ok((self.evaluate_of)(call))
    }

    async fn screenshot(&self) -> Result<Vec<u8>, EngineError> {
        Ok(Vec::new())
    }

    async fn screenshot_with_options(
        &self,
        options: &crate::capture::ScreenshotOptions,
    ) -> Result<Vec<u8>, EngineError> {
        options.validate()?;
        let Some(capture) = &self.capture else {
            // The trait default: only the plain viewport capture.
            let native = crate::capture::ScreenshotOptions {
                stable_viewport: false,
                ..options.clone()
            };
            if native != crate::capture::ScreenshotOptions::default() {
                return Err(crate::capture::unsupported(self, "screenshot options"));
            }
            return self.screenshot().await;
        };
        capture.calls.lock().unwrap().push(options.clone());
        match (options.stable_viewport, capture.view_fails) {
            (true, true) => Err(EngineError::Browser(
                "CDP sessions are only supported by Chromium".into(),
            )),
            (true, false) => Ok(b"view".to_vec()),
            (false, _) => self.screenshot().await,
        }
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
