//! Node.js CLI bridge for Playwright and Puppeteer engines.
//!
//! Rust does not have official Playwright or Puppeteer bindings. This adapter
//! keeps those engine names available by delegating browser operations to the
//! official Node.js packages over a line-delimited JSON protocol.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine as _;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::browser::launcher::LaunchOptions;
use crate::core::engine::{ElementInfo, EngineAdapter, EngineError, EngineType, PdfOptions};

const BRIDGE_SCRIPT: &str = include_str!("node_engine_bridge.js");

/// [`EngineAdapter`] backed by a Node.js Playwright or Puppeteer subprocess.
pub struct NodeBridgePage {
    engine: EngineType,
    inner: Arc<Mutex<NodeBridgeProcess>>,
    stderr_task: Arc<Mutex<Option<JoinHandle<()>>>>,
}

struct NodeBridgeProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
}

#[derive(Debug, Deserialize)]
struct BridgeResponse {
    id: u64,
    ok: bool,
    #[serde(default)]
    result: Value,
    #[serde(default)]
    error: Option<String>,
}

impl NodeBridgePage {
    pub(crate) async fn launch(
        options: LaunchOptions,
        user_data_dir: PathBuf,
    ) -> Result<Self, anyhow::Error> {
        let engine = options.engine;
        if !matches!(engine, EngineType::Playwright | EngineType::Puppeteer) {
            return Err(anyhow::anyhow!(
                "Node bridge only supports playwright and puppeteer engines"
            ));
        }

        let node = options
            .node_executable
            .clone()
            .unwrap_or_else(|| PathBuf::from("node"));
        let mut command = Command::new(node);
        command
            .arg("--input-type=module")
            .arg("-e")
            .arg(BRIDGE_SCRIPT)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        if let Some(ref working_dir) = options.node_working_dir {
            command.current_dir(working_dir);
        }

        let mut child = command
            .spawn()
            .map_err(|err| anyhow::anyhow!("failed to start Node.js bridge: {}", err))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("Node.js bridge stdin was not captured"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("Node.js bridge stdout was not captured"))?;
        let stderr = child.stderr.take();

        let stderr_task = stderr.map(|stderr| {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    tracing::debug!(target: "browser_commander::node_bridge", "{line}");
                }
            })
        });

        let page = Self {
            engine,
            inner: Arc::new(Mutex::new(NodeBridgeProcess {
                child,
                stdin,
                stdout: BufReader::new(stdout),
                next_id: 0,
            })),
            stderr_task: Arc::new(Mutex::new(stderr_task)),
        };

        page.request(
            "launch",
            json!({
                "engine": engine.to_string(),
                "userDataDir": path_to_string(&user_data_dir),
                "headless": options.headless,
                "slowMo": options.slow_mo,
                "verbose": options.verbose,
                "args": options.all_chrome_args(),
                "colorScheme": options.color_scheme.as_ref().map(|cs| cs.as_str()),
                "sandbox": options.sandbox,
            }),
        )
        .await
        .map_err(|err| anyhow::anyhow!("{}", err))?;

        Ok(page)
    }

    /// Close the browser subprocess. Dropping the adapter also terminates it.
    pub async fn close(&self) -> Result<(), EngineError> {
        let close_result = self.request("close", json!({})).await;
        let mut inner = self.inner.lock().await;
        let _ = inner.child.start_kill();
        if let Some(task) = self.stderr_task.lock().await.take() {
            task.abort();
        }
        close_result.map(|_| ())
    }

    async fn request(&self, method: &str, params: Value) -> Result<Value, EngineError> {
        let mut inner = self.inner.lock().await;
        inner.next_id = inner.next_id.saturating_add(1);
        let id = inner.next_id;
        let request = json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let mut encoded = serde_json::to_vec(&request).map_err(|err| {
            EngineError::Browser(format!("bridge request encoding failed: {err}"))
        })?;
        encoded.push(b'\n');

        inner
            .stdin
            .write_all(&encoded)
            .await
            .map_err(|err| EngineError::Browser(format!("bridge write failed: {err}")))?;
        inner
            .stdin
            .flush()
            .await
            .map_err(|err| EngineError::Browser(format!("bridge flush failed: {err}")))?;

        let mut line = String::new();
        loop {
            line.clear();
            let bytes = inner
                .stdout
                .read_line(&mut line)
                .await
                .map_err(|err| EngineError::Browser(format!("bridge read failed: {err}")))?;
            if bytes == 0 {
                return Err(EngineError::Browser(
                    "Node.js bridge exited before responding".to_string(),
                ));
            }

            let response: BridgeResponse =
                serde_json::from_str(line.trim_end()).map_err(|err| {
                    EngineError::Browser(format!(
                        "bridge returned invalid JSON: {err}; line={}",
                        line.trim_end()
                    ))
                })?;

            if response.id != id {
                tracing::debug!(
                    expected_id = id,
                    actual_id = response.id,
                    "ignoring out-of-order bridge response"
                );
                continue;
            }

            if response.ok {
                return Ok(response.result);
            }

            return Err(EngineError::Browser(
                response
                    .error
                    .unwrap_or_else(|| "Node.js bridge command failed".to_string()),
            ));
        }
    }

    async fn string_request(&self, method: &str, params: Value) -> Result<String, EngineError> {
        let value = self.request(method, params).await?;
        Ok(value.as_str().unwrap_or_default().to_string())
    }

    async fn bool_request(&self, method: &str, params: Value) -> Result<bool, EngineError> {
        let value = self.request(method, params).await?;
        Ok(value.as_bool().unwrap_or(false))
    }
}

impl std::fmt::Debug for NodeBridgePage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NodeBridgePage")
            .field("engine", &self.engine)
            .finish()
    }
}

impl Drop for NodeBridgePage {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.inner.try_lock() {
            let _ = inner.child.start_kill();
        }
        if let Ok(mut task) = self.stderr_task.try_lock() {
            if let Some(handle) = task.take() {
                handle.abort();
            }
        }
    }
}

#[async_trait]
impl EngineAdapter for NodeBridgePage {
    fn engine_type(&self) -> EngineType {
        self.engine
    }

    async fn url(&self) -> Result<String, EngineError> {
        self.string_request("url", json!({})).await
    }

    async fn goto(&self, url: &str) -> Result<(), EngineError> {
        self.request("goto", json!({ "url": url })).await?;
        Ok(())
    }

    async fn query_selector(&self, selector: &str) -> Result<Option<ElementInfo>, EngineError> {
        let value = self
            .request("querySelector", json!({ "selector": selector }))
            .await?;
        element_info_from_value(&value)
    }

    async fn query_selector_all(&self, selector: &str) -> Result<Vec<ElementInfo>, EngineError> {
        let value = self
            .request("querySelectorAll", json!({ "selector": selector }))
            .await?;
        let Some(items) = value.as_array() else {
            return Ok(Vec::new());
        };
        let mut infos = Vec::with_capacity(items.len());
        for item in items {
            if let Some(info) = element_info_from_value(item)? {
                infos.push(info);
            }
        }
        Ok(infos)
    }

    async fn count(&self, selector: &str) -> Result<usize, EngineError> {
        let value = self
            .request("count", json!({ "selector": selector }))
            .await?;
        Ok(value.as_u64().unwrap_or(0) as usize)
    }

    async fn click(&self, selector: &str) -> Result<(), EngineError> {
        self.request("click", json!({ "selector": selector }))
            .await?;
        Ok(())
    }

    async fn fill(&self, selector: &str, text: &str) -> Result<(), EngineError> {
        self.request("fill", json!({ "selector": selector, "text": text }))
            .await?;
        Ok(())
    }

    async fn type_text(&self, selector: &str, text: &str) -> Result<(), EngineError> {
        self.request("typeText", json!({ "selector": selector, "text": text }))
            .await?;
        Ok(())
    }

    async fn text_content(&self, selector: &str) -> Result<Option<String>, EngineError> {
        let value = self
            .request("textContent", json!({ "selector": selector }))
            .await?;
        Ok(value.as_str().map(ToString::to_string))
    }

    async fn input_value(&self, selector: &str) -> Result<Option<String>, EngineError> {
        let value = self
            .request("inputValue", json!({ "selector": selector }))
            .await?;
        Ok(value.as_str().map(ToString::to_string))
    }

    async fn get_attribute(
        &self,
        selector: &str,
        attribute: &str,
    ) -> Result<Option<String>, EngineError> {
        let value = self
            .request(
                "getAttribute",
                json!({ "selector": selector, "attribute": attribute }),
            )
            .await?;
        Ok(value.as_str().map(ToString::to_string))
    }

    async fn is_visible(&self, selector: &str) -> Result<bool, EngineError> {
        self.bool_request("isVisible", json!({ "selector": selector }))
            .await
    }

    async fn is_enabled(&self, selector: &str) -> Result<bool, EngineError> {
        self.bool_request("isEnabled", json!({ "selector": selector }))
            .await
    }

    async fn wait_for_selector(&self, selector: &str, timeout_ms: u64) -> Result<(), EngineError> {
        self.request(
            "waitForSelector",
            json!({ "selector": selector, "timeoutMs": timeout_ms }),
        )
        .await?;
        Ok(())
    }

    async fn scroll_into_view(&self, selector: &str) -> Result<(), EngineError> {
        self.request("scrollIntoView", json!({ "selector": selector }))
            .await?;
        Ok(())
    }

    async fn evaluate(&self, script: &str) -> Result<Value, EngineError> {
        self.request("evaluate", json!({ "script": script })).await
    }

    async fn screenshot(&self) -> Result<Vec<u8>, EngineError> {
        decode_base64(self.string_request("screenshot", json!({})).await?)
    }

    async fn pdf(&self, options: PdfOptions) -> Result<Vec<u8>, EngineError> {
        let pdf_options = json!({
            "format": options.format,
            "printBackground": options.print_background,
            "margin": {
                "top": options.margin_top,
                "right": options.margin_right,
                "bottom": options.margin_bottom,
                "left": options.margin_left,
            },
            "scale": options.scale,
            "path": options.path,
        });
        let encoded = self
            .request("pdf", pdf_options)
            .await?
            .as_str()
            .unwrap_or_default()
            .to_string();
        decode_base64(encoded)
    }

    async fn bring_to_front(&self) -> Result<(), EngineError> {
        self.request("bringToFront", json!({})).await?;
        Ok(())
    }

    async fn wait_for_navigation(&self, timeout_ms: u64) -> Result<(), EngineError> {
        self.request("waitForNavigation", json!({ "timeoutMs": timeout_ms }))
            .await?;
        Ok(())
    }

    async fn keyboard_press(&self, key: &str) -> Result<(), EngineError> {
        self.request("keyboardPress", json!({ "key": key })).await?;
        Ok(())
    }

    async fn keyboard_type(&self, text: &str) -> Result<(), EngineError> {
        self.request("keyboardType", json!({ "text": text }))
            .await?;
        Ok(())
    }

    async fn keyboard_down(&self, key: &str) -> Result<(), EngineError> {
        self.request("keyboardDown", json!({ "key": key })).await?;
        Ok(())
    }

    async fn keyboard_up(&self, key: &str) -> Result<(), EngineError> {
        self.request("keyboardUp", json!({ "key": key })).await?;
        Ok(())
    }
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn decode_base64(value: impl AsRef<str>) -> Result<Vec<u8>, EngineError> {
    base64::engine::general_purpose::STANDARD
        .decode(value.as_ref())
        .map_err(|err| EngineError::Browser(format!("bridge returned invalid base64: {err}")))
}

fn element_info_from_value(value: &Value) -> Result<Option<ElementInfo>, EngineError> {
    if value.is_null() {
        return Ok(None);
    }

    let bounding_box = value.get("boundingBox").and_then(|box_value| {
        let items = box_value.as_array()?;
        if items.len() != 4 {
            return None;
        }
        Some((
            items[0].as_f64().unwrap_or_default(),
            items[1].as_f64().unwrap_or_default(),
            items[2].as_f64().unwrap_or_default(),
            items[3].as_f64().unwrap_or_default(),
        ))
    });

    Ok(Some(ElementInfo {
        tag_name: value
            .get("tagName")
            .and_then(Value::as_str)
            .unwrap_or("UNKNOWN")
            .to_string(),
        text_content: value
            .get("textContent")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        is_visible: value
            .get("isVisible")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        is_enabled: value
            .get("isEnabled")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        bounding_box,
    }))
}
