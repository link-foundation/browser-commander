//! Native Playwright engine: typed calls to the official driver.
//!
//! [`PlaywrightDriverPage`] drives the browser through the generated
//! [`crate::playwright::protocol`] bindings over `playwright run-driver`, the
//! way Playwright's own Python, Java and .NET clients do. It mirrors the
//! Playwright half of `node_engine_bridge.js` call for call, so the generic
//! Node bridge is only needed when no matching driver is installed.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use serde_json::{json, Map, Value};

use crate::core::engine::{ElementInfo, EngineAdapter, EngineError, EngineType, PdfOptions};
use crate::playwright::protocol::*;
use crate::playwright::{ChannelType, DriverOptions, PlaywrightDriver, ProtocolError};

/// Timeout of actions and navigations, Playwright's default.
pub const ACTION_TIMEOUT_MS: f64 = 30_000.0;
/// Timeout of a browser launch, Playwright's default.
pub const LAUNCH_TIMEOUT_MS: f64 = 180_000.0;
const VERSION_PAGE_TIMEOUT_MS: f64 = 10_000.0;

/// What to launch: the browser command line has already been resolved.
#[derive(Debug, Clone, Default)]
pub struct PlaywrightLaunch {
    /// How to start the driver.
    pub driver: DriverOptions,
    /// Profile directory of the persistent context.
    pub user_data_dir: PathBuf,
    /// Run without a window.
    pub headless: bool,
    /// Delay between operations, in milliseconds.
    pub slow_mo: u64,
    /// Browser switches.
    pub args: Vec<String>,
    /// Variables added to the driver's environment for the browser process.
    pub env: Option<HashMap<String, String>>,
    /// Drop every Playwright default switch.
    pub ignore_all_default_args: bool,
    /// Playwright default switches to drop.
    pub ignore_default_args: Vec<String>,
    /// `light`, `dark` or `no-preference`.
    pub color_scheme: Option<String>,
    /// Keep Chromium's sandbox on.
    pub sandbox: bool,
    /// Browser channel (`chrome`, `msedge`…).
    pub channel: Option<String>,
    /// Browser executable.
    pub executable_path: Option<PathBuf>,
    /// Launch timeout; Playwright's default when unset.
    pub timeout: Option<Duration>,
}

/// What to attach to.
#[derive(Debug, Clone, Default)]
pub struct PlaywrightConnect {
    /// How to start the driver.
    pub driver: DriverOptions,
    /// `http://` or `ws://` DevTools endpoint.
    pub endpoint: String,
    /// Delay between operations, in milliseconds.
    pub slow_mo: u64,
    /// Connection timeout; Playwright's default when unset.
    pub timeout: Option<Duration>,
    /// Cookies (Playwright's shape) added to the default context.
    pub seed_cookies: Vec<Value>,
    /// Emulated on the picked page, best-effort.
    pub color_scheme: Option<String>,
}

/// [`EngineAdapter`] backed by the official Playwright driver.
pub struct PlaywrightDriverPage {
    driver: Arc<PlaywrightDriver>,
    browser: Browser,
    context: BrowserContext,
    page: Page,
    frame: Frame,
    launched: bool,
}

impl std::fmt::Debug for PlaywrightDriverPage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlaywrightDriverPage")
            .field("driver", &self.driver)
            .field("page", &self.page.guid())
            .finish()
    }
}

impl PlaywrightDriverPage {
    /// Start a driver and launch a persistent context through it.
    pub async fn launch(options: PlaywrightLaunch) -> Result<Self, ProtocolError> {
        let driver = PlaywrightDriver::launch(options.driver.clone()).await?;
        Self::launch_with(driver, options).await
    }

    /// Launch a persistent context through a running driver.
    pub async fn launch_with(
        driver: PlaywrightDriver,
        options: PlaywrightLaunch,
    ) -> Result<Self, ProtocolError> {
        let driver = Arc::new(driver);
        driver
            .connection()
            .set_default_timeout(Some(ACTION_TIMEOUT_MS));
        let chromium = chromium(&driver)?;
        let params = launch_params(&options)?;
        let timeout = options.timeout.map(millis).unwrap_or(LAUNCH_TIMEOUT_MS);
        let result: BrowserTypeLaunchPersistentContextResult = chromium
            .channel()
            .send_with_timeout("launchPersistentContext", &params, Some(timeout))
            .await?;
        let connection = driver.connection();
        let browser = connection.object(&result.browser)?;
        let context: BrowserContext = connection.object(&result.context)?;
        let page = match connection
            .children::<Page>(context.guid())
            .into_iter()
            .next()
        {
            Some(page) => page,
            None => connection.object(&context.new_page().await?.page)?,
        };
        let adapter = Self::assemble(driver, browser, context, page, true)?;
        if let Err(error) = adapter.page.bring_to_front().await {
            tracing::debug!(%error, "bringToFront failed");
        }
        Ok(adapter)
    }

    /// Start a driver and attach it to a running browser over CDP.
    pub async fn connect(options: PlaywrightConnect) -> Result<Self, ProtocolError> {
        let driver = PlaywrightDriver::launch(options.driver.clone()).await?;
        Self::connect_with(driver, options).await
    }

    /// Attach a running driver to a running browser over CDP.
    pub async fn connect_with(
        driver: PlaywrightDriver,
        options: PlaywrightConnect,
    ) -> Result<Self, ProtocolError> {
        let driver = Arc::new(driver);
        driver
            .connection()
            .set_default_timeout(Some(ACTION_TIMEOUT_MS));
        let chromium = chromium(&driver)?;
        let params = BrowserTypeConnectOverCDPParams {
            endpoint_url: Some(options.endpoint.clone()),
            slow_mo: (options.slow_mo > 0).then_some(options.slow_mo as f64),
            ..Default::default()
        };
        let timeout = options.timeout.map(millis).unwrap_or(ACTION_TIMEOUT_MS);
        let result: BrowserTypeConnectOverCDPResult = chromium
            .channel()
            .send_with_timeout("connectOverCDP", &params, Some(timeout))
            .await?;
        let connection = driver.connection();
        let browser: Browser = connection.object(&result.browser)?;
        let context: BrowserContext = match &result.default_context {
            Some(context) => connection.object(context)?,
            None => connection
                .children::<BrowserContext>(browser.guid())
                .into_iter()
                .next()
                .ok_or_else(|| {
                    ProtocolError::Driver(
                        "Connected browser did not expose a default context".to_string(),
                    )
                })?,
        };
        let pages = connection.children::<Page>(context.guid());
        let page = match pick_foreground_page(connection, pages).await? {
            Some(page) => page,
            None => connection.object(&context.new_page().await?.page)?,
        };
        if !options.seed_cookies.is_empty() {
            let cookies = serde_json::from_value(Value::Array(options.seed_cookies.clone()))?;
            context
                .add_cookies(BrowserContextAddCookiesParams { cookies })
                .await?;
        }
        let adapter = Self::assemble(driver, browser, context, page, false)?;
        if let Some(scheme) = &options.color_scheme {
            let color_scheme = serde_json::from_value(json!(scheme))?;
            let emulated = adapter
                .page
                .emulate_media(PageEmulateMediaParams {
                    color_scheme: Some(color_scheme),
                    ..Default::default()
                })
                .await;
            if let Err(error) = emulated {
                tracing::debug!(%error, "colorScheme failed");
            }
        }
        if let Err(error) = adapter.page.bring_to_front().await {
            tracing::debug!(%error, "bringToFront failed");
        }
        Ok(adapter)
    }

    fn assemble(
        driver: Arc<PlaywrightDriver>,
        browser: Browser,
        context: BrowserContext,
        page: Page,
        launched: bool,
    ) -> Result<Self, ProtocolError> {
        let frame = driver
            .connection()
            .object(&page.initializer()?.main_frame)?;
        Ok(Self {
            driver,
            browser,
            context,
            page,
            frame,
            launched,
        })
    }

    /// The driver this page talks to.
    pub fn driver(&self) -> &PlaywrightDriver {
        &self.driver
    }

    /// The typed browser, context, page and main frame, for everything the
    /// [`EngineAdapter`] surface does not cover.
    pub fn objects(&self) -> (&Browser, &BrowserContext, &Page, &Frame) {
        (&self.browser, &self.context, &self.page, &self.frame)
    }

    /// Close the browser (a launched one) or disconnect from it (an attached
    /// one), then stop the driver.
    pub async fn close(&self) -> Result<(), EngineError> {
        let closed = if self.launched {
            self.context.close(Default::default()).await
        } else {
            self.browser.close(Default::default()).await
        };
        self.driver.close().await;
        closed.map_err(engine_error)
    }

    async fn call(&self, function: &str, arg: Value) -> Result<Value, EngineError> {
        evaluate(&self.frame, function, Some(true), &arg)
            .await
            .map_err(engine_error)
    }

    async fn call_selector(&self, function: &str, selector: &str) -> Result<Value, EngineError> {
        self.call(function, json!(selector)).await
    }
}

fn chromium(driver: &PlaywrightDriver) -> Result<BrowserType, ProtocolError> {
    driver
        .connection()
        .object(&driver.playwright().initializer()?.chromium)
}

fn launch_params(
    options: &PlaywrightLaunch,
) -> Result<BrowserTypeLaunchPersistentContextParams, ProtocolError> {
    let mut args = options.args.clone();
    if !options.sandbox {
        for flag in ["--no-sandbox", "--disable-setuid-sandbox"] {
            if !args.iter().any(|arg| arg == flag) {
                args.push(flag.to_string());
            }
        }
    }
    // The browser gets the driver's environment plus the caller's, as the
    // bridge gives it Node's; this process's environment is not changed.
    let env = options.env.as_ref().map(|extra| {
        let mut merged: Vec<(String, String)> = std::env::vars()
            .filter(|(name, _)| !extra.contains_key(name))
            .chain(
                extra
                    .iter()
                    .map(|(name, value)| (name.clone(), value.clone())),
            )
            .collect();
        merged.sort();
        merged
            .into_iter()
            .map(|(name, value)| NameValue { name, value })
            .collect()
    });
    let color_scheme = options
        .color_scheme
        .as_ref()
        .map(|scheme| serde_json::from_value(json!(scheme)))
        .transpose()?;
    Ok(BrowserTypeLaunchPersistentContextParams {
        launch_options: LaunchOptions {
            channel: options.channel.clone(),
            executable_path: options
                .executable_path
                .as_ref()
                .map(|path| path.to_string_lossy().into_owned()),
            args: Some(args),
            ignore_all_default_args: options.ignore_all_default_args.then_some(true),
            ignore_default_args: (!options.ignore_all_default_args)
                .then(|| options.ignore_default_args.clone()),
            env,
            headless: Some(options.headless),
            chromium_sandbox: Some(options.sandbox),
            ..Default::default()
        },
        context_options: ContextOptions {
            no_default_viewport: Some(true),
            color_scheme,
            ..Default::default()
        },
        user_data_dir: options.user_data_dir.to_string_lossy().into_owned(),
        slow_mo: (options.slow_mo > 0).then_some(options.slow_mo as f64),
    })
}

/// A fresh profile can open a tab that takes the foreground after startup,
/// so the visible tab wins over the first one.
async fn pick_foreground_page(
    connection: &crate::playwright::Connection,
    pages: Vec<Page>,
) -> Result<Option<Page>, ProtocolError> {
    for page in &pages {
        let frame: Frame = connection.object(&page.initializer()?.main_frame)?;
        match evaluate(&frame, "document.visibilityState", None, &Value::Null).await {
            Ok(state) if state == "visible" => return Ok(Some(page.clone())),
            Ok(_) => {}
            Err(error) => tracing::debug!(%error, "visibilityState failed"),
        }
    }
    Ok(pages.into_iter().next())
}

async fn evaluate(
    frame: &Frame,
    expression: &str,
    is_function: Option<bool>,
    arg: &Value,
) -> Result<Value, ProtocolError> {
    let result = frame
        .evaluate_expression(FrameEvaluateExpressionParams {
            expression: expression.to_string(),
            is_function,
            arg: SerializedArgument {
                value: serialize_value(arg),
                handles: Vec::new(),
            },
        })
        .await?;
    Ok(deserialize_value(&result.value))
}

fn engine_error(error: ProtocolError) -> EngineError {
    if error.is_timeout() {
        EngineError::Timeout(error.to_string())
    } else {
        EngineError::Browser(error.to_string())
    }
}

fn millis(duration: Duration) -> f64 {
    duration.as_millis() as f64
}

fn decode_binary(value: &str) -> Result<Vec<u8>, EngineError> {
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|err| EngineError::Browser(format!("driver returned invalid base64: {err}")))
}

/// JSON to the protocol's `SerializedValue`.
pub fn serialize_value(value: &Value) -> SerializedValue {
    match value {
        Value::Null => SerializedValue {
            v: Some(SerializedValueV::Null),
            ..Default::default()
        },
        Value::Bool(b) => SerializedValue {
            b: Some(*b),
            ..Default::default()
        },
        Value::Number(n) => SerializedValue {
            n: n.as_f64(),
            ..Default::default()
        },
        Value::String(s) => SerializedValue {
            s: Some(s.clone()),
            ..Default::default()
        },
        Value::Array(items) => SerializedValue {
            a: Some(items.iter().map(serialize_value).collect()),
            ..Default::default()
        },
        Value::Object(entries) => SerializedValue {
            o: Some(
                entries
                    .iter()
                    .map(|(k, v)| SerializedValueO {
                        k: k.clone(),
                        v: serialize_value(v),
                    })
                    .collect(),
            ),
            ..Default::default()
        },
    }
}

/// The protocol's `SerializedValue` to JSON, as `JSON.stringify` would see
/// it: `undefined`, `NaN`, the infinities, handles and cycles become `null`;
/// dates, URLs, big integers and regular expressions become strings; errors
/// become `{name, message, stack}`; typed arrays become arrays of numbers.
pub fn deserialize_value(value: &SerializedValue) -> Value {
    if let Some(n) = value.n {
        return number(n);
    }
    if let Some(b) = value.b {
        return Value::Bool(b);
    }
    if let Some(s) = &value.s {
        return Value::String(s.clone());
    }
    if let Some(special) = value.v {
        return match special {
            SerializedValueV::Negative0 => json!(0),
            _ => Value::Null,
        };
    }
    if let Some(text) = value.d.as_ref().or(value.u.as_ref()).or(value.bi.as_ref()) {
        return Value::String(text.clone());
    }
    if let Some(regex) = &value.r {
        return Value::String(format!("/{}/{}", regex.p, regex.f));
    }
    if let Some(error) = &value.e {
        return json!({ "name": error.n, "message": error.m, "stack": error.s });
    }
    if let Some(array) = &value.ta {
        return typed_array(array);
    }
    if let Some(items) = &value.a {
        return Value::Array(items.iter().map(deserialize_value).collect());
    }
    if let Some(entries) = &value.o {
        let object: Map<String, Value> = entries
            .iter()
            .map(|entry| (entry.k.clone(), deserialize_value(&entry.v)))
            .collect();
        return Value::Object(object);
    }
    Value::Null
}

/// A JavaScript number as `JSON.stringify` prints it: integral values have
/// no fraction, non-finite ones are `null`.
fn number(n: f64) -> Value {
    const SAFE: f64 = 9_007_199_254_740_991.0;
    if n.fract() == 0.0 && n.abs() <= SAFE {
        json!(n as i64)
    } else {
        serde_json::Number::from_f64(n).map_or(Value::Null, Value::Number)
    }
}

fn typed_array(array: &SerializedValueTa) -> Value {
    use SerializedValueTaK as K;
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&array.b) else {
        return Value::Null;
    };
    let size = match array.k {
        K::I8 | K::Ui8 | K::Ui8c => 1,
        K::I16 | K::Ui16 => 2,
        K::I32 | K::Ui32 | K::F32 => 4,
        K::F64 | K::Bi64 | K::Bui64 => 8,
    };
    let items = bytes.chunks_exact(size).map(|chunk| {
        let mut word = [0u8; 8];
        word[..size].copy_from_slice(chunk);
        let unsigned = u64::from_le_bytes(word);
        match array.k {
            K::I8 => json!(chunk[0] as i8),
            K::Ui8 | K::Ui8c => json!(chunk[0]),
            K::I16 => json!(unsigned as u16 as i16),
            K::Ui16 => json!(unsigned as u16),
            K::I32 => json!(unsigned as u32 as i32),
            K::Ui32 => json!(unsigned as u32),
            K::F32 => number(f32::from_bits(unsigned as u32) as f64),
            K::F64 => number(f64::from_bits(unsigned)),
            K::Bi64 => json!((unsigned as i64).to_string()),
            K::Bui64 => json!(unsigned.to_string()),
        }
    });
    Value::Array(items.collect())
}

fn element_info(value: &Value) -> Option<ElementInfo> {
    if value.is_null() {
        return None;
    }
    let bounding_box = value["boundingBox"].as_array().and_then(|items| {
        let item = |index: usize| items.get(index).and_then(Value::as_f64);
        Some((item(0)?, item(1)?, item(2)?, item(3)?))
    });
    Some(ElementInfo {
        tag_name: value["tagName"].as_str().unwrap_or("UNKNOWN").to_string(),
        text_content: value["textContent"].as_str().map(ToString::to_string),
        is_visible: value["isVisible"].as_bool().unwrap_or(false),
        is_enabled: value["isEnabled"].as_bool().unwrap_or(true),
        bounding_box,
    })
}

const DESCRIBE: &str = r#"(el) => {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const isVisible = style.display !== "none" && style.visibility !== "hidden" &&
    rect.width > 0 && rect.height > 0;
  return {
    tagName: el.tagName,
    textContent: el.textContent,
    isVisible,
    isEnabled: !el.disabled,
    boundingBox: isVisible ? [rect.x, rect.y, rect.width, rect.height] : null,
  };
}"#;

fn query_one() -> String {
    format!(
        "(selector) => {{ const el = document.querySelector(selector); return el ? ({DESCRIBE})(el) : null; }}"
    )
}

fn query_all() -> String {
    format!("(selector) => Array.from(document.querySelectorAll(selector), {DESCRIBE})")
}

const COUNT: &str = "(selector) => document.querySelectorAll(selector).length";
const TEXT_CONTENT: &str =
    "(selector) => { const el = document.querySelector(selector); return el ? el.textContent : null; }";
const INPUT_VALUE: &str = "(selector) => { const el = document.querySelector(selector); return el && \"value\" in el ? el.value : null; }";
const GET_ATTRIBUTE: &str = "({ selector, attribute }) => { const el = document.querySelector(selector); return el ? el.getAttribute(attribute) : null; }";
const IS_ENABLED: &str =
    "(selector) => { const el = document.querySelector(selector); return el ? !el.disabled : false; }";
const SCROLL_INTO_VIEW: &str = r#"(selector) => {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  el.scrollIntoView({ block: "center", inline: "center" });
}"#;
const RESTORE_LOCAL_STORAGE: &str = r#"(origins) => {
  const entry = origins.find((item) => item.origin === globalThis.location.origin);
  if (!entry) return;
  for (const item of entry.localStorage) globalThis.localStorage.setItem(item.name, item.value);
}"#;
const VERSION_PAGE_READY: &str = r#"() => document.getElementById("command_line")?.textContent"#;

#[async_trait]
impl EngineAdapter for PlaywrightDriverPage {
    fn engine_type(&self) -> EngineType {
        EngineType::Playwright
    }

    async fn url(&self) -> Result<String, EngineError> {
        Ok(self.frame.initializer().map_err(engine_error)?.url)
    }

    async fn goto(&self, url: &str) -> Result<(), EngineError> {
        self.frame
            .goto(FrameGotoParams {
                url: url.to_string(),
                wait_until: Some(LifecycleEvent::Load),
                ..Default::default()
            })
            .await
            .map_err(engine_error)?;
        Ok(())
    }

    async fn goto_with_options(
        &self,
        url: &str,
        wait_until: &str,
        _timeout_ms: u64,
    ) -> Result<(), EngineError> {
        self.frame
            .goto(FrameGotoParams {
                url: url.to_string(),
                wait_until: Some(match wait_until {
                    "domcontentloaded" => LifecycleEvent::Domcontentloaded,
                    "networkidle" => LifecycleEvent::Networkidle,
                    _ => LifecycleEvent::Load,
                }),
                ..Default::default()
            })
            .await
            .map_err(engine_error)?;
        Ok(())
    }

    async fn query_selector(&self, selector: &str) -> Result<Option<ElementInfo>, EngineError> {
        Ok(element_info(
            &self.call_selector(&query_one(), selector).await?,
        ))
    }

    async fn query_selector_all(&self, selector: &str) -> Result<Vec<ElementInfo>, EngineError> {
        let value = self.call_selector(&query_all(), selector).await?;
        Ok(value
            .as_array()
            .map(|items| items.iter().filter_map(element_info).collect())
            .unwrap_or_default())
    }

    async fn count(&self, selector: &str) -> Result<usize, EngineError> {
        let value = self.call_selector(COUNT, selector).await?;
        Ok(value.as_u64().unwrap_or(0) as usize)
    }

    async fn click(&self, selector: &str) -> Result<(), EngineError> {
        self.frame
            .click(FrameClickParams {
                selector: selector.to_string(),
                ..Default::default()
            })
            .await
            .map_err(engine_error)
    }

    async fn mouse_click(&self, x: f64, y: f64) -> Result<(), EngineError> {
        self.page
            .mouse_click(PageMouseClickParams {
                x,
                y,
                ..Default::default()
            })
            .await
            .map_err(engine_error)
    }

    async fn fill(&self, selector: &str, text: &str) -> Result<(), EngineError> {
        self.frame
            .fill(FrameFillParams {
                selector: selector.to_string(),
                value: text.to_string(),
                ..Default::default()
            })
            .await
            .map_err(engine_error)
    }

    async fn type_text(&self, selector: &str, text: &str) -> Result<(), EngineError> {
        self.frame
            .focus(FrameFocusParams {
                selector: selector.to_string(),
                ..Default::default()
            })
            .await
            .map_err(engine_error)?;
        self.keyboard_type(text).await
    }

    async fn text_content(&self, selector: &str) -> Result<Option<String>, EngineError> {
        let value = self.call_selector(TEXT_CONTENT, selector).await?;
        Ok(value.as_str().map(ToString::to_string))
    }

    async fn input_value(&self, selector: &str) -> Result<Option<String>, EngineError> {
        let value = self.call_selector(INPUT_VALUE, selector).await?;
        Ok(value.as_str().map(ToString::to_string))
    }

    async fn get_attribute(
        &self,
        selector: &str,
        attribute: &str,
    ) -> Result<Option<String>, EngineError> {
        let value = self
            .call(
                GET_ATTRIBUTE,
                json!({ "selector": selector, "attribute": attribute }),
            )
            .await?;
        Ok(value.as_str().map(ToString::to_string))
    }

    async fn is_visible(&self, selector: &str) -> Result<bool, EngineError> {
        Ok(self
            .query_selector(selector)
            .await?
            .is_some_and(|info| info.is_visible))
    }

    async fn is_enabled(&self, selector: &str) -> Result<bool, EngineError> {
        let value = self.call_selector(IS_ENABLED, selector).await?;
        Ok(value.as_bool().unwrap_or(false))
    }

    async fn wait_for_selector(&self, selector: &str, timeout_ms: u64) -> Result<(), EngineError> {
        let params = FrameWaitForSelectorParams {
            selector: selector.to_string(),
            state: Some(FrameWaitForSelectorParamsState::Visible),
            ..Default::default()
        };
        let _: FrameWaitForSelectorResult = self
            .frame
            .channel()
            .send_with_timeout("waitForSelector", &params, Some(timeout_ms as f64))
            .await
            .map_err(engine_error)?;
        Ok(())
    }

    async fn scroll_into_view(&self, selector: &str) -> Result<(), EngineError> {
        self.call_selector(SCROLL_INTO_VIEW, selector).await?;
        Ok(())
    }

    async fn evaluate(&self, script: &str) -> Result<Value, EngineError> {
        // Like `page.evaluate(string)`: the driver calls the expression when
        // it evaluates to a function.
        evaluate(&self.frame, script, None, &Value::Null)
            .await
            .map_err(engine_error)
    }

    async fn read_browser_version_page(&self) -> Result<Value, EngineError> {
        let connection = self.driver.connection();
        let created = self.context.new_page().await.map_err(engine_error)?;
        let page: Page = connection.object(&created.page).map_err(engine_error)?;
        let read = async {
            let frame: Frame = connection.object(&page.initializer()?.main_frame)?;
            frame
                .goto(FrameGotoParams {
                    url: "chrome://version".to_string(),
                    ..Default::default()
                })
                .await?;
            let ready = FrameWaitForFunctionParams {
                expression: VERSION_PAGE_READY.to_string(),
                is_function: Some(true),
                arg: SerializedArgument {
                    value: serialize_value(&Value::Null),
                    handles: Vec::new(),
                },
                ..Default::default()
            };
            let _: FrameWaitForFunctionResult = frame
                .channel()
                .send_with_timeout("waitForFunction", &ready, Some(VERSION_PAGE_TIMEOUT_MS))
                .await?;
            evaluate(
                &frame,
                crate::parity::VERSION_EXPRESSION,
                None,
                &Value::Null,
            )
            .await
        }
        .await;
        let _ = page.close(Default::default()).await;
        read.map_err(engine_error)
    }

    async fn restore_storage_state(&self, state: Value) -> Result<(), EngineError> {
        let mut state = state;
        if let Some(cookies) = state["cookies"].as_array() {
            state["cookies"] = json!(super::session_cookies::normalize_session_cookies(
                cookies.clone(),
                EngineType::Playwright
            ));
        }
        let cookies = state.get("cookies").cloned().unwrap_or_else(|| json!([]));
        let cookies: Vec<SetNetworkCookie> = serde_json::from_value(cookies)
            .map_err(|err| EngineError::Browser(format!("invalid storage state cookie: {err}")))?;
        let origins = state.get("origins").cloned().unwrap_or_else(|| json!([]));
        if !cookies.is_empty() {
            self.context
                .add_cookies(BrowserContextAddCookiesParams { cookies })
                .await
                .map_err(engine_error)?;
        }
        if origins.as_array().is_some_and(|items| !items.is_empty()) {
            self.context
                .add_init_script(BrowserContextAddInitScriptParams {
                    source: format!("({RESTORE_LOCAL_STORAGE})({origins})"),
                })
                .await
                .map_err(engine_error)?;
            let connection = self.driver.connection();
            for page in connection.children::<Page>(self.context.guid()) {
                let frame: Frame = page
                    .initializer()
                    .and_then(|init| connection.object(&init.main_frame))
                    .map_err(engine_error)?;
                evaluate(&frame, RESTORE_LOCAL_STORAGE, Some(true), &origins)
                    .await
                    .map_err(engine_error)?;
            }
        }
        Ok(())
    }

    async fn export_storage_state(&self) -> Result<Value, EngineError> {
        let state = self
            .context
            .storage_state(Default::default())
            .await
            .map_err(engine_error)?;
        serde_json::to_value(state).map_err(|err| EngineError::Browser(err.to_string()))
    }

    async fn delete_cookies(&self, cookies: Vec<Value>) -> Result<(), EngineError> {
        for cookie in cookies {
            self.context
                .clear_cookies(
                    crate::playwright::protocol::BrowserContextClearCookiesParams {
                        name: cookie["name"].as_str().map(String::from),
                        domain: cookie["domain"].as_str().map(String::from),
                        path: cookie["path"].as_str().map(String::from),
                        ..Default::default()
                    },
                )
                .await
                .map_err(engine_error)?;
        }
        Ok(())
    }

    async fn screenshot(&self) -> Result<Vec<u8>, EngineError> {
        let shot = self
            .page
            .screenshot(Default::default())
            .await
            .map_err(engine_error)?;
        decode_binary(&shot.binary)
    }

    async fn pdf(&self, options: PdfOptions) -> Result<Vec<u8>, EngineError> {
        let margin = PagePdfParamsMargin {
            top: options.margin_top,
            right: options.margin_right,
            bottom: options.margin_bottom,
            left: options.margin_left,
        };
        let has_margin = margin != PagePdfParamsMargin::default();
        let result = self
            .page
            .pdf(PagePdfParams {
                format: options.format,
                print_background: Some(options.print_background),
                margin: has_margin.then_some(margin),
                scale: options.scale,
                ..Default::default()
            })
            .await
            .map_err(engine_error)?;
        let bytes = decode_binary(&result.pdf)?;
        if let Some(path) = options.path {
            tokio::fs::write(&path, &bytes)
                .await
                .map_err(|err| EngineError::Browser(format!("cannot write {path}: {err}")))?;
        }
        Ok(bytes)
    }

    async fn bring_to_front(&self) -> Result<(), EngineError> {
        self.page.bring_to_front().await.map_err(engine_error)
    }

    async fn wait_for_navigation(&self, timeout_ms: u64) -> Result<(), EngineError> {
        // Subscribe before looking, so a `load` between the two is not missed.
        let mut events = self.frame.events();
        let loaded = |frame: &Frame| {
            frame
                .initializer()
                .map(|init| init.load_states.contains(&LifecycleEvent::Load))
        };
        if loaded(&self.frame).map_err(engine_error)? {
            return Ok(());
        }
        let wait = async {
            loop {
                if let FrameEvent::Loadstate(FrameLoadstateEventParams {
                    add: Some(LifecycleEvent::Load),
                    ..
                }) = events.recv().await?
                {
                    return Ok::<(), ProtocolError>(());
                }
            }
        };
        tokio::time::timeout(Duration::from_millis(timeout_ms), wait)
            .await
            .map_err(|_| {
                EngineError::Timeout(format!(
                    "waiting for the load event exceeded {timeout_ms} ms"
                ))
            })?
            .map_err(engine_error)
    }

    async fn keyboard_press(&self, key: &str) -> Result<(), EngineError> {
        self.page
            .keyboard_press(PageKeyboardPressParams {
                key: key.to_string(),
                ..Default::default()
            })
            .await
            .map_err(engine_error)
    }

    async fn keyboard_type(&self, text: &str) -> Result<(), EngineError> {
        self.page
            .keyboard_type(PageKeyboardTypeParams {
                text: text.to_string(),
                ..Default::default()
            })
            .await
            .map_err(engine_error)
    }

    async fn keyboard_down(&self, key: &str) -> Result<(), EngineError> {
        self.page
            .keyboard_down(PageKeyboardDownParams {
                key: key.to_string(),
            })
            .await
            .map_err(engine_error)
    }

    async fn keyboard_up(&self, key: &str) -> Result<(), EngineError> {
        self.page
            .keyboard_up(PageKeyboardUpParams {
                key: key.to_string(),
            })
            .await
            .map_err(engine_error)
    }
}

#[cfg(test)]
#[path = "playwright_driver_page_tests.rs"]
mod tests;
