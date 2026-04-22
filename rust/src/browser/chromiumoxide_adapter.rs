//! Chromiumoxide-backed [`EngineAdapter`] implementation.
//!
//! Wraps a live [`chromiumoxide::Page`] and the owning [`chromiumoxide::Browser`]
//! so that browser-commander operations (goto, click, fill, evaluate, ...) can
//! be executed against a real Chromium instance launched via the Chrome
//! DevTools Protocol.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use chromiumoxide::cdp::browser_protocol::page::PrintToPdfParams;
use chromiumoxide::{Browser as CdpBrowser, Page as CdpPage};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::browser::media::ColorScheme;
use crate::core::engine::{ElementInfo, EngineAdapter, EngineError, EngineType, PdfOptions};

/// A [`EngineAdapter`] that drives a Chromium browser through
/// `chromiumoxide`.
///
/// Obtained from [`launch_browser`](super::launcher::launch_browser).
/// The adapter owns the browser handle along with the background task that
/// services CDP events; dropping the adapter (or calling
/// [`ChromiumoxidePage::close`]) terminates the browser process.
pub struct ChromiumoxidePage {
    page: CdpPage,
    browser: Arc<Mutex<Option<CdpBrowser>>>,
    handler_task: Arc<Mutex<Option<JoinHandle<()>>>>,
    user_data_dir: PathBuf,
}

impl ChromiumoxidePage {
    pub(crate) fn new(
        page: CdpPage,
        browser: CdpBrowser,
        handler_task: JoinHandle<()>,
        user_data_dir: PathBuf,
    ) -> Self {
        Self {
            page,
            browser: Arc::new(Mutex::new(Some(browser))),
            handler_task: Arc::new(Mutex::new(Some(handler_task))),
            user_data_dir,
        }
    }

    /// Access the underlying [`chromiumoxide::Page`] for engine-specific
    /// operations that are not yet covered by the unified API.
    pub fn raw_page(&self) -> &CdpPage {
        &self.page
    }

    /// The resolved user data directory used for this browser session.
    pub fn user_data_dir(&self) -> &PathBuf {
        &self.user_data_dir
    }

    /// Emulate a CSS `prefers-color-scheme` media feature on the live page.
    pub async fn set_color_scheme(&self, scheme: Option<&ColorScheme>) -> Result<(), EngineError> {
        use chromiumoxide::cdp::browser_protocol::emulation::{
            MediaFeature, SetEmulatedMediaParams,
        };

        let features = match scheme {
            Some(cs) => vec![MediaFeature {
                name: "prefers-color-scheme".to_string(),
                value: cs.as_str().to_string(),
            }],
            None => Vec::new(),
        };

        self.page
            .execute(SetEmulatedMediaParams::builder().features(features).build())
            .await
            .map_err(to_engine_error)?;
        Ok(())
    }

    /// Close the browser and terminate the background CDP handler task.
    ///
    /// Idempotent: calling more than once is a no-op.
    pub async fn close(&self) -> Result<(), EngineError> {
        let browser = self.browser.lock().await.take();
        if let Some(mut browser) = browser {
            let _ = browser.close().await;
            let _ = browser.wait().await;
        }
        let handle = self.handler_task.lock().await.take();
        if let Some(handle) = handle {
            handle.abort();
            let _ = handle.await;
        }
        Ok(())
    }
}

impl std::fmt::Debug for ChromiumoxidePage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ChromiumoxidePage")
            .field("user_data_dir", &self.user_data_dir)
            .finish()
    }
}

impl Drop for ChromiumoxidePage {
    fn drop(&mut self) {
        // Best-effort cleanup without blocking the current runtime. If the
        // user did not call `close()` explicitly, abort the background task
        // so the Tokio runtime can terminate cleanly.
        if let Ok(mut guard) = self.handler_task.try_lock() {
            if let Some(handle) = guard.take() {
                handle.abort();
            }
        }
    }
}

fn to_engine_error(err: impl std::fmt::Display) -> EngineError {
    EngineError::Browser(err.to_string())
}

async fn eval_value(page: &CdpPage, script: String) -> Result<serde_json::Value, EngineError> {
    let result = page.evaluate(script).await.map_err(to_engine_error)?;
    Ok(result.value().cloned().unwrap_or(serde_json::Value::Null))
}

fn js_selector_call(selector: &str, body: &str) -> String {
    // Build a JS snippet that invokes `body` on the element matched by
    // `selector`, returning `null` when nothing matches. `body` must be a JS
    // expression or statement sequence referring to `el` as the element.
    format!(
        r#"(() => {{
            const el = document.querySelector({});
            if (!el) return null;
            {}
        }})()"#,
        serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".to_string()),
        body
    )
}

#[async_trait]
impl EngineAdapter for ChromiumoxidePage {
    fn engine_type(&self) -> EngineType {
        EngineType::Chromiumoxide
    }

    async fn url(&self) -> Result<String, EngineError> {
        let url = self.page.url().await.map_err(to_engine_error)?;
        Ok(url.unwrap_or_default())
    }

    async fn goto(&self, url: &str) -> Result<(), EngineError> {
        self.page.goto(url).await.map_err(to_engine_error)?;
        self.page
            .wait_for_navigation()
            .await
            .map_err(to_engine_error)?;
        Ok(())
    }

    async fn query_selector(&self, selector: &str) -> Result<Option<ElementInfo>, EngineError> {
        match self.page.find_element(selector).await {
            Ok(element) => {
                let tag_name = element
                    .attribute("tagName")
                    .await
                    .map_err(to_engine_error)?
                    .unwrap_or_else(|| "UNKNOWN".to_string());
                let text = element.inner_text().await.map_err(to_engine_error)?;
                let bounding_box = element
                    .bounding_box()
                    .await
                    .ok()
                    .map(|b| (b.x, b.y, b.width, b.height));
                Ok(Some(ElementInfo {
                    tag_name,
                    text_content: text,
                    is_visible: bounding_box.is_some(),
                    is_enabled: true,
                    bounding_box,
                }))
            }
            Err(_) => Ok(None),
        }
    }

    async fn query_selector_all(&self, selector: &str) -> Result<Vec<ElementInfo>, EngineError> {
        let elements = self
            .page
            .find_elements(selector)
            .await
            .map_err(to_engine_error)?;
        let mut infos = Vec::with_capacity(elements.len());
        for element in elements {
            let tag_name = element
                .attribute("tagName")
                .await
                .map_err(to_engine_error)?
                .unwrap_or_else(|| "UNKNOWN".to_string());
            let text = element.inner_text().await.map_err(to_engine_error)?;
            let bounding_box = element
                .bounding_box()
                .await
                .ok()
                .map(|b| (b.x, b.y, b.width, b.height));
            infos.push(ElementInfo {
                tag_name,
                text_content: text,
                is_visible: bounding_box.is_some(),
                is_enabled: true,
                bounding_box,
            });
        }
        Ok(infos)
    }

    async fn count(&self, selector: &str) -> Result<usize, EngineError> {
        let script = format!(
            "document.querySelectorAll({}).length",
            serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".to_string())
        );
        let value = eval_value(&self.page, script).await?;
        Ok(value.as_u64().unwrap_or(0) as usize)
    }

    async fn click(&self, selector: &str) -> Result<(), EngineError> {
        let element = self
            .page
            .find_element(selector)
            .await
            .map_err(to_engine_error)?;
        element.click().await.map_err(to_engine_error)?;
        Ok(())
    }

    async fn fill(&self, selector: &str, text: &str) -> Result<(), EngineError> {
        // Clear the current value, then type the new text.
        let clear_script = js_selector_call(
            selector,
            "el.focus(); if ('value' in el) { el.value = ''; \
             el.dispatchEvent(new Event('input', {bubbles:true})); } return true;",
        );
        eval_value(&self.page, clear_script).await?;
        let element = self
            .page
            .find_element(selector)
            .await
            .map_err(to_engine_error)?;
        element.click().await.map_err(to_engine_error)?;
        element.type_str(text).await.map_err(to_engine_error)?;
        Ok(())
    }

    async fn type_text(&self, selector: &str, text: &str) -> Result<(), EngineError> {
        let element = self
            .page
            .find_element(selector)
            .await
            .map_err(to_engine_error)?;
        element.click().await.map_err(to_engine_error)?;
        element.type_str(text).await.map_err(to_engine_error)?;
        Ok(())
    }

    async fn text_content(&self, selector: &str) -> Result<Option<String>, EngineError> {
        match self.page.find_element(selector).await {
            Ok(element) => element.inner_text().await.map_err(to_engine_error),
            Err(_) => Ok(None),
        }
    }

    async fn input_value(&self, selector: &str) -> Result<Option<String>, EngineError> {
        let script = js_selector_call(selector, "return 'value' in el ? el.value : null;");
        let value = eval_value(&self.page, script).await?;
        Ok(match value {
            serde_json::Value::Null => None,
            serde_json::Value::String(s) => Some(s),
            other => Some(other.to_string()),
        })
    }

    async fn get_attribute(
        &self,
        selector: &str,
        attribute: &str,
    ) -> Result<Option<String>, EngineError> {
        let script = js_selector_call(
            selector,
            &format!(
                "return el.getAttribute({});",
                serde_json::to_string(attribute).unwrap_or_else(|_| "\"\"".to_string())
            ),
        );
        let value = eval_value(&self.page, script).await?;
        Ok(match value {
            serde_json::Value::Null => None,
            serde_json::Value::String(s) => Some(s),
            other => Some(other.to_string()),
        })
    }

    async fn is_visible(&self, selector: &str) -> Result<bool, EngineError> {
        let script = js_selector_call(
            selector,
            "const style = window.getComputedStyle(el); \
             if (style.display === 'none' || style.visibility === 'hidden') return false; \
             const rect = el.getBoundingClientRect(); \
             return rect.width > 0 && rect.height > 0;",
        );
        let value = eval_value(&self.page, script).await?;
        Ok(value.as_bool().unwrap_or(false))
    }

    async fn is_enabled(&self, selector: &str) -> Result<bool, EngineError> {
        let script = js_selector_call(selector, "return !el.disabled;");
        let value = eval_value(&self.page, script).await?;
        Ok(value.as_bool().unwrap_or(false))
    }

    async fn wait_for_selector(&self, selector: &str, timeout_ms: u64) -> Result<(), EngineError> {
        let deadline = std::time::Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            if self.page.find_element(selector).await.is_ok() {
                return Ok(());
            }
            if std::time::Instant::now() >= deadline {
                return Err(EngineError::Timeout(format!(
                    "wait_for_selector: {} not found in {}ms",
                    selector, timeout_ms
                )));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    async fn scroll_into_view(&self, selector: &str) -> Result<(), EngineError> {
        let element = self
            .page
            .find_element(selector)
            .await
            .map_err(to_engine_error)?;
        element.scroll_into_view().await.map_err(to_engine_error)?;
        Ok(())
    }

    async fn evaluate(&self, script: &str) -> Result<serde_json::Value, EngineError> {
        eval_value(&self.page, script.to_string()).await
    }

    async fn screenshot(&self) -> Result<Vec<u8>, EngineError> {
        use chromiumoxide::page::ScreenshotParams;
        self.page
            .screenshot(ScreenshotParams::builder().build())
            .await
            .map_err(to_engine_error)
    }

    async fn pdf(&self, options: PdfOptions) -> Result<Vec<u8>, EngineError> {
        let mut builder = PrintToPdfParams::builder().print_background(options.print_background);
        if let Some(scale) = options.scale {
            builder = builder.scale(scale);
        }
        // Margins are interpreted as inches. browser-commander accepts CSS
        // margin strings; translate common units so callers can pass
        // e.g. "1cm" / "0.5in" / "10mm".
        if let Some(v) = css_length_to_inches(options.margin_top.as_deref()) {
            builder = builder.margin_top(v);
        }
        if let Some(v) = css_length_to_inches(options.margin_bottom.as_deref()) {
            builder = builder.margin_bottom(v);
        }
        if let Some(v) = css_length_to_inches(options.margin_left.as_deref()) {
            builder = builder.margin_left(v);
        }
        if let Some(v) = css_length_to_inches(options.margin_right.as_deref()) {
            builder = builder.margin_right(v);
        }
        if let Some(format) = options.format.as_deref() {
            if let Some((w, h)) = paper_format_inches(format) {
                builder = builder.paper_width(w).paper_height(h);
            }
        }
        let params = builder.build();
        let bytes = self.page.pdf(params).await.map_err(to_engine_error)?;
        if let Some(path) = options.path {
            tokio::fs::write(path, &bytes)
                .await
                .map_err(|e| EngineError::Browser(format!("failed to write pdf: {}", e)))?;
        }
        Ok(bytes)
    }

    async fn bring_to_front(&self) -> Result<(), EngineError> {
        self.page.bring_to_front().await.map_err(to_engine_error)?;
        Ok(())
    }

    async fn wait_for_navigation(&self, _timeout_ms: u64) -> Result<(), EngineError> {
        self.page
            .wait_for_navigation()
            .await
            .map_err(to_engine_error)?;
        Ok(())
    }

    async fn keyboard_press(&self, key: &str) -> Result<(), EngineError> {
        use chromiumoxide::cdp::browser_protocol::input::{
            DispatchKeyEventParams, DispatchKeyEventType,
        };
        self.page
            .execute(
                DispatchKeyEventParams::builder()
                    .r#type(DispatchKeyEventType::KeyDown)
                    .key(key.to_string())
                    .build()
                    .map_err(EngineError::Browser)?,
            )
            .await
            .map_err(to_engine_error)?;
        self.page
            .execute(
                DispatchKeyEventParams::builder()
                    .r#type(DispatchKeyEventType::KeyUp)
                    .key(key.to_string())
                    .build()
                    .map_err(EngineError::Browser)?,
            )
            .await
            .map_err(to_engine_error)?;
        Ok(())
    }

    async fn keyboard_type(&self, text: &str) -> Result<(), EngineError> {
        use chromiumoxide::cdp::browser_protocol::input::{
            DispatchKeyEventParams, DispatchKeyEventType,
        };
        for ch in text.chars() {
            self.page
                .execute(
                    DispatchKeyEventParams::builder()
                        .r#type(DispatchKeyEventType::Char)
                        .text(ch.to_string())
                        .build()
                        .map_err(EngineError::Browser)?,
                )
                .await
                .map_err(to_engine_error)?;
        }
        Ok(())
    }

    async fn keyboard_down(&self, key: &str) -> Result<(), EngineError> {
        use chromiumoxide::cdp::browser_protocol::input::{
            DispatchKeyEventParams, DispatchKeyEventType,
        };
        self.page
            .execute(
                DispatchKeyEventParams::builder()
                    .r#type(DispatchKeyEventType::KeyDown)
                    .key(key.to_string())
                    .build()
                    .map_err(EngineError::Browser)?,
            )
            .await
            .map_err(to_engine_error)?;
        Ok(())
    }

    async fn keyboard_up(&self, key: &str) -> Result<(), EngineError> {
        use chromiumoxide::cdp::browser_protocol::input::{
            DispatchKeyEventParams, DispatchKeyEventType,
        };
        self.page
            .execute(
                DispatchKeyEventParams::builder()
                    .r#type(DispatchKeyEventType::KeyUp)
                    .key(key.to_string())
                    .build()
                    .map_err(EngineError::Browser)?,
            )
            .await
            .map_err(to_engine_error)?;
        Ok(())
    }
}

/// Convert a CSS length (`"1in"`, `"2cm"`, `"10mm"`, `"72px"`) to inches for
/// the CDP PDF API. Returns `None` on unknown/missing units.
fn css_length_to_inches(value: Option<&str>) -> Option<f64> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    let (num_str, unit) = raw
        .find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
        .map(|idx| raw.split_at(idx))
        .unwrap_or((raw, "in"));
    let value: f64 = num_str.parse().ok()?;
    Some(match unit.trim() {
        "in" | "" => value,
        "cm" => value / 2.54,
        "mm" => value / 25.4,
        "px" => value / 96.0,
        "pt" => value / 72.0,
        _ => return None,
    })
}

/// Convert common paper format names into `(width, height)` in inches.
fn paper_format_inches(name: &str) -> Option<(f64, f64)> {
    let n = name.trim().to_ascii_lowercase();
    Some(match n.as_str() {
        "letter" => (8.5, 11.0),
        "legal" => (8.5, 14.0),
        "tabloid" => (11.0, 17.0),
        "ledger" => (17.0, 11.0),
        "a0" => (33.1, 46.8),
        "a1" => (23.4, 33.1),
        "a2" => (16.54, 23.4),
        "a3" => (11.7, 16.54),
        "a4" => (8.27, 11.69),
        "a5" => (5.83, 8.27),
        "a6" => (4.13, 5.83),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_length_to_inches_handles_common_units() {
        assert_eq!(css_length_to_inches(Some("1in")), Some(1.0));
        assert_eq!(css_length_to_inches(Some("2.54cm")), Some(1.0));
        assert_eq!(css_length_to_inches(Some("25.4mm")), Some(1.0));
        assert_eq!(css_length_to_inches(Some("96px")), Some(1.0));
        assert_eq!(css_length_to_inches(Some("72pt")), Some(1.0));
    }

    #[test]
    fn css_length_to_inches_rejects_unknown_units() {
        assert_eq!(css_length_to_inches(Some("10xx")), None);
        assert_eq!(css_length_to_inches(None), None);
        assert_eq!(css_length_to_inches(Some("")), None);
    }

    #[test]
    fn css_length_to_inches_defaults_to_inches() {
        // A bare number is treated as inches.
        assert_eq!(css_length_to_inches(Some("1")), Some(1.0));
    }

    #[test]
    fn paper_format_inches_known_formats() {
        assert_eq!(paper_format_inches("A4"), Some((8.27, 11.69)));
        assert_eq!(paper_format_inches("letter"), Some((8.5, 11.0)));
        assert_eq!(paper_format_inches("Legal"), Some((8.5, 14.0)));
    }

    #[test]
    fn paper_format_inches_unknown() {
        assert!(paper_format_inches("weird").is_none());
    }
}
