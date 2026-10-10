//! What a trace recorder needs from the page it records (issue #108).
//!
//! JavaScript reaches into a Playwright or Puppeteer page directly; Rust asks
//! through [`TracePage`] instead, so the recorder works the same over any
//! [`EngineAdapter`] and over a fake page in tests. Every in-page function the
//! recorder runs comes from the shared `assets.json`, so Rust evaluates the very
//! code JavaScript does.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures::stream::BoxStream;

use super::jsonfmt::Json;
use crate::core::engine::{EngineAdapter, TraceEngineEvent};

/// The page a [`super::recorder::TraceRecorder`] records.
///
/// Errors are plain messages: a trace records them, it does not interpret
/// them, except that one mentioning `closed` is reported as `page-closed`.
#[async_trait]
pub trait TracePage: Send + Sync {
    /// Engine adapter for optional frame/video capture.
    fn adapter(&self) -> Option<Arc<dyn EngineAdapter>> {
        None
    }
    fn require_feature(&self, _feature: &str) -> Result<(), crate::core::engine::EngineError> {
        Ok(())
    }
    /// The engine's name, written to the manifest unless the options name one.
    fn engine(&self) -> Option<String> {
        None
    }

    /// A value that is the same for every page of one browser context.
    fn context_key(&self) -> Option<usize> {
        None
    }

    /// A value that is the same every time this page is traced.
    fn page_key(&self) -> Option<usize> {
        None
    }

    /// Whether the page belongs to a browser context a record can name.
    fn has_context(&self) -> bool {
        false
    }

    /// Call the JavaScript function `source` with `argument` in the page and
    /// return what it resolved to, with object keys in the page's order.
    async fn evaluate_function(&self, source: &str, argument: &Json) -> Result<Json, String>;

    /// A PNG of the page, or `None` when the engine cannot take one.
    async fn screenshot(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(None)
    }

    /// Run `source` with `argument` before the code of every future document.
    ///
    /// `Some(identifier)` can be passed to [`TracePage::remove_init_script`];
    /// `None` means the registration stays (or the engine has no such hook).
    async fn add_init_script(
        &self,
        _source: &str,
        _argument: &Json,
    ) -> Result<Option<String>, String> {
        Ok(None)
    }

    /// Undo [`TracePage::add_init_script`].
    async fn remove_init_script(&self, _identifier: &str) -> Result<(), String> {
        Ok(())
    }

    /// Opt-in network activity.
    async fn network_events(
        &self,
        _options: super::network::NetworkTraceOptions,
    ) -> Result<BoxStream<'static, TraceEngineEvent>, crate::core::EngineError> {
        Err(crate::core::EngineError::Unsupported {
            browser: self.engine().unwrap_or_default(),
            feature: "network tracing".into(),
        })
    }
    /// Page activity the trace records as it happens, when the engine reports any.
    async fn events(&self) -> Option<BoxStream<'static, TraceEngineEvent>> {
        None
    }
}

/// `(source)(argument)`, as an expression.
pub(crate) fn call_expression(source: &str, argument: &Json) -> String {
    format!("({source})({})", argument.to_compact())
}

/// An expression that resolves to the call's result as JSON text.
///
/// Engines hand evaluation results back as `serde_json::Value`, which sorts
/// object keys; serializing in the page keeps the order the page produced, which
/// is the order JavaScript writes to the bundle.
pub(crate) fn json_text_expression(source: &str, argument: &Json) -> String {
    format!(
        "Promise.resolve().then(async () => {{ const value = await {}; \
         return value === undefined ? null : JSON.stringify(value); }})",
        call_expression(source, argument)
    )
}

/// A [`TracePage`] over any [`EngineAdapter`].
#[derive(Clone)]
pub struct AdapterTracePage {
    adapter: Arc<dyn EngineAdapter>,
}

impl AdapterTracePage {
    /// Trace the page behind `adapter`.
    pub fn new(adapter: Arc<dyn EngineAdapter>) -> Self {
        Self { adapter }
    }

    fn key(&self) -> usize {
        Arc::as_ptr(&self.adapter).cast::<()>() as usize
    }
}

#[async_trait]
impl TracePage for AdapterTracePage {
    fn adapter(&self) -> Option<Arc<dyn EngineAdapter>> {
        Some(self.adapter.clone())
    }

    fn require_feature(&self, feature: &str) -> Result<(), crate::core::engine::EngineError> {
        self.adapter.require_feature(feature)
    }
    fn engine(&self) -> Option<String> {
        Some(self.adapter.engine_type().to_string())
    }

    /// An adapter drives one page in its own context, so they share a key.
    fn context_key(&self) -> Option<usize> {
        Some(self.key())
    }

    fn page_key(&self) -> Option<usize> {
        Some(self.key())
    }

    fn has_context(&self) -> bool {
        true
    }

    async fn evaluate_function(&self, source: &str, argument: &Json) -> Result<Json, String> {
        let value = self
            .adapter
            .evaluate(&json_text_expression(source, argument))
            .await
            .map_err(|error| error.to_string())?;
        match value {
            serde_json::Value::String(text) => {
                Json::parse(&text).map_err(|error| format!("unreadable page result: {error}"))
            }
            serde_json::Value::Null => Ok(Json::Null),
            other => Ok(Json::from(other)),
        }
    }

    async fn screenshot(&self) -> Result<Option<Vec<u8>>, String> {
        self.adapter
            .screenshot()
            .await
            .map(Some)
            .map_err(|error| error.to_string())
    }

    async fn add_init_script(
        &self,
        source: &str,
        argument: &Json,
    ) -> Result<Option<String>, String> {
        self.adapter
            .add_init_script(&call_expression(source, argument))
            .await
            .map_err(|error| error.to_string())
    }

    async fn remove_init_script(&self, identifier: &str) -> Result<(), String> {
        self.adapter
            .remove_init_script(identifier)
            .await
            .map_err(|error| error.to_string())
    }

    async fn network_events(
        &self,
        options: super::network::NetworkTraceOptions,
    ) -> Result<BoxStream<'static, TraceEngineEvent>, crate::core::EngineError> {
        self.adapter.trace_network_events(options).await
    }

    async fn events(&self) -> Option<BoxStream<'static, TraceEngineEvent>> {
        self.adapter.trace_events().await
    }
}

/// `withDeadline` from `js/src/traces/deadline.js`: `0` means no deadline.
pub(crate) async fn with_deadline<T>(
    work: impl Future<Output = Result<T, String>>,
    timeout_ms: u64,
    what: &str,
) -> Result<T, String> {
    if timeout_ms == 0 {
        return work.await;
    }
    match tokio::time::timeout(Duration::from_millis(timeout_ms), work).await {
        Ok(outcome) => outcome,
        Err(_) => Err(format!("{what} timed out after {timeout_ms}ms")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::traces::jsonfmt::JsonObject;

    #[test]
    fn calls_keep_the_argument_order() {
        let argument = Json::from(JsonObject::new().with("b", 1).with("a", "x"));
        assert_eq!(
            call_expression("function f(o) {}", &argument),
            r#"(function f(o) {})({"b":1,"a":"x"})"#
        );
        assert!(json_text_expression("function f() {}", &Json::Null)
            .contains("await (function f() {})(null);"));
    }

    #[tokio::test]
    async fn deadlines_name_what_timed_out() {
        let slow = async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            Ok::<_, String>(())
        };
        assert_eq!(
            with_deadline(slow, 5, "trace screenshot").await,
            Err("trace screenshot timed out after 5ms".to_string())
        );
        assert_eq!(
            with_deadline(async { Ok::<_, String>(1) }, 0, "x").await,
            Ok(1)
        );
    }
}
