//! The shared browser API backed by the full native Playwright client.
use super::{generated, launch_playwright, ManagedPlaywright};
use crate::browser::{connector::ConnectOptions, launcher::LaunchOptions, media::ColorScheme};
use crate::core::engine::{ElementInfo, EngineAdapter, EngineError, EngineType, PdfOptions};
use crate::fingerprint::apply::CdpTransport;
use async_trait::async_trait;
use playwright_rs::{
    protocol::{Browser, BrowserContext, CDPSession, Page},
    server::{channel_owner::ChannelOwner, connection::ConnectionExt},
};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, sync::Arc};

fn error(value: impl std::fmt::Display) -> EngineError {
    EngineError::Browser(value.to_string())
}
fn driver_options(
    mut options: super::PlaywrightDriverOptions,
    node: Option<&std::path::PathBuf>,
) -> anyhow::Result<super::PlaywrightDriverOptions> {
    if let Some(node) = node {
        if options.cli_script.is_none() {
            options.cli_script = Some(playwright_rs::server::driver::get_driver_executable()?.1);
        }
        options.node_executable = Some(node.clone());
    }
    Ok(options)
}

/// A native official-driver page. Engine-specific APIs remain available through
/// `raw_page`, `context`, `browser`, and `driver`, including typed protocol channels.
pub struct NativePlaywrightPage {
    driver: Arc<ManagedPlaywright>,
    browser: Browser,
    context: BrowserContext,
    page: Page,
    cdp: CDPSession,
}
impl NativePlaywrightPage {
    pub fn raw_page(&self) -> &Page {
        &self.page
    }
    pub fn context(&self) -> &BrowserContext {
        &self.context
    }
    pub fn browser(&self) -> &Browser {
        &self.browser
    }
    pub fn driver(&self) -> &ManagedPlaywright {
        &self.driver
    }
    pub async fn close(&self) -> anyhow::Result<()> {
        // A CDP-connected Browser.close disconnects; an engine-launched one
        // closes its owned browser. Driver shutdown also closes owned contexts.
        let _ = self.browser.close().await;
        self.driver.close().await
    }
    async fn from_context(
        driver: Arc<ManagedPlaywright>,
        browser: Browser,
        context: BrowserContext,
    ) -> anyhow::Result<Self> {
        let pages = context.pages();
        let mut selected = pages.first().cloned();
        for page in pages {
            if matches!(
                page.evaluate::<(), String>("document.visibilityState", None)
                    .await
                    .as_deref(),
                Ok("visible")
            ) {
                selected = Some(page);
                break;
            }
        }
        let page = match selected {
            Some(page) => page,
            None => context.new_page().await?,
        };
        let cdp = context.new_cdp_session(&page).await?;
        Ok(Self {
            driver,
            browser,
            context,
            page,
            cdp,
        })
    }
    pub(crate) async fn launch(
        options: &LaunchOptions,
        args: &[String],
        env: Option<&HashMap<String, String>>,
        profile: &Path,
    ) -> anyhow::Result<Self> {
        let driver = Arc::new(
            launch_playwright(driver_options(
                options.playwright_driver.clone(),
                options.node_executable.as_ref(),
            )?)
            .await?,
        );
        let chromium = driver.client().chromium();
        let channel = generated::browser_type::BrowserTypeChannel::new(
            driver.connection(),
            chromium.guid().to_string(),
        );
        let environment = env.map(|values| {
            values
                .iter()
                .map(|(name, value)| json!({"name":name,"value":value}))
                .collect::<Vec<_>>()
        });
        // Deserialize common options into the generated schema rather than
        // letting a second launch helper introduce its own switches/viewport.
        let params = serde_json::from_value(json!({
            "userDataDir": profile.to_string_lossy(), "headless": options.headless,
            "args": args, "env":environment, "channel":options.channel,
            "executablePath":options.executable_path.as_ref().map(|p|p.to_string_lossy()),
            "ignoreDefaultArgs": if options.ignore_all_default_args { None } else { Some(options.all_ignored_default_args()) },
            "ignoreAllDefaultArgs": options.ignore_all_default_args,
            "chromiumSandbox":options.sandbox, "slowMo":options.slow_mo,
            "noDefaultViewport":true, "acceptDownloads":"internal-browser-default"
        }))?;
        let result = tokio::time::timeout(
            options
                .launch_timeout
                .unwrap_or(std::time::Duration::from_secs(30)),
            channel.launch_persistent_context(params),
        )
        .await??;
        let browser = driver
            .connection()
            .get_typed::<Browser>(&result.browser.guid)
            .await?;
        let context = driver
            .connection()
            .get_typed::<BrowserContext>(&result.context.guid)
            .await?;
        Self::from_context(driver, browser, context).await
    }
    pub(crate) async fn connect(options: &ConnectOptions) -> anyhow::Result<Self> {
        let driver = Arc::new(
            launch_playwright(driver_options(
                options.playwright_driver.clone(),
                options.node_executable.as_ref(),
            )?)
            .await?,
        );
        let mut settings = playwright_rs::api::ConnectOverCdpOptions::default();
        settings.slow_mo = Some(options.slow_mo as f64);
        settings.no_defaults = Some(true);
        settings.timeout = options.timeout.map(|d| d.as_secs_f64() * 1000.0);
        let browser = driver
            .client()
            .chromium()
            .connect_over_cdp(options.endpoint()?, settings)
            .await?;
        let context = browser
            .contexts()
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("CDP browser has no default context"))?;
        Self::from_context(driver, browser, context).await
    }
    pub async fn set_color_scheme(&self, scheme: Option<&ColorScheme>) -> anyhow::Result<()> {
        let features = scheme
            .map(|s| vec![json!({"name":"prefers-color-scheme","value":s.as_str()})])
            .unwrap_or_default();
        self.send("Emulation.setEmulatedMedia", json!({"features":features}))
            .await?;
        Ok(())
    }
    async fn elements(&self, selector: &str) -> Result<Vec<ElementInfo>, EngineError> {
        let values: Vec<Value> = self.page.evaluate(r#"selector => [...document.querySelectorAll(selector)].map(e => {
            const r=e.getBoundingClientRect(), s=getComputedStyle(e);
            return {tag:e.tagName,text:e.textContent,visible:!!(r.width&&r.height)&&s.visibility!=='hidden'&&s.display!=='none',enabled:!e.disabled,box:[r.x,r.y,r.width,r.height]};
        })"#,Some(&selector)).await.map_err(error)?;
        values
            .into_iter()
            .map(|v| {
                Ok(ElementInfo {
                    tag_name: v["tag"].as_str().unwrap_or("").into(),
                    text_content: v["text"].as_str().map(str::to_owned),
                    is_visible: v["visible"].as_bool().unwrap_or(false),
                    is_enabled: v["enabled"].as_bool().unwrap_or(false),
                    bounding_box: Some(serde_json::from_value(v["box"].clone()).map_err(error)?),
                })
            })
            .collect()
    }
}
#[async_trait]
impl CdpTransport for NativePlaywrightPage {
    async fn send(&self, method: &str, params: Value) -> anyhow::Result<Value> {
        Ok(self.cdp.send(method, Some(params)).await?)
    }
}
#[async_trait]
impl EngineAdapter for NativePlaywrightPage {
    fn as_playwright(&self) -> Option<&Self> {
        Some(self)
    }
    fn engine_type(&self) -> EngineType {
        EngineType::Playwright
    }
    async fn url(&self) -> Result<String, EngineError> {
        Ok(self.page.url())
    }
    async fn goto(&self, url: &str) -> Result<(), EngineError> {
        self.page.goto(url, None).await.map_err(error)?;
        Ok(())
    }
    async fn query_selector(&self, s: &str) -> Result<Option<ElementInfo>, EngineError> {
        Ok(self.elements(s).await?.into_iter().next())
    }
    async fn query_selector_all(&self, s: &str) -> Result<Vec<ElementInfo>, EngineError> {
        self.elements(s).await
    }
    async fn count(&self, s: &str) -> Result<usize, EngineError> {
        self.page.locator(s).count().await.map_err(error)
    }
    async fn click(&self, s: &str) -> Result<(), EngineError> {
        self.page.locator(s).click(None).await.map_err(error)
    }
    async fn mouse_click(&self, x: f64, y: f64) -> Result<(), EngineError> {
        self.page.mouse().click(x, y, None).await.map_err(error)
    }
    async fn fill(&self, s: &str, t: &str) -> Result<(), EngineError> {
        self.page.locator(s).fill(t, None).await.map_err(error)
    }
    async fn type_text(&self, s: &str, t: &str) -> Result<(), EngineError> {
        self.page
            .locator(s)
            .press_sequentially(t, None)
            .await
            .map_err(error)
    }
    async fn text_content(&self, s: &str) -> Result<Option<String>, EngineError> {
        self.page.locator(s).text_content().await.map_err(error)
    }
    async fn input_value(&self, s: &str) -> Result<Option<String>, EngineError> {
        self.page
            .locator(s)
            .input_value(None)
            .await
            .map(Some)
            .map_err(error)
    }
    async fn get_attribute(&self, s: &str, a: &str) -> Result<Option<String>, EngineError> {
        self.page.locator(s).get_attribute(a).await.map_err(error)
    }
    async fn is_visible(&self, s: &str) -> Result<bool, EngineError> {
        self.page.locator(s).is_visible().await.map_err(error)
    }
    async fn is_enabled(&self, s: &str) -> Result<bool, EngineError> {
        self.page.locator(s).is_enabled().await.map_err(error)
    }
    async fn wait_for_selector(&self, s: &str, t: u64) -> Result<(), EngineError> {
        let mut options = playwright_rs::protocol::WaitForOptions::default();
        options.timeout = Some(t as f64);
        self.page.locator(s).wait_for(options).await.map_err(error)
    }
    async fn scroll_into_view(&self, s: &str) -> Result<(), EngineError> {
        self.page
            .locator(s)
            .scroll_into_view_if_needed()
            .await
            .map_err(error)
    }
    async fn evaluate(&self, s: &str) -> Result<Value, EngineError> {
        self.page.evaluate(s, None::<&()>).await.map_err(error)
    }
    async fn read_browser_version_page(&self) -> Result<Value, EngineError> {
        let page = self.context.new_page().await.map_err(error)?;
        let result=async {
            page.goto("chrome://version",None).await.map_err(error)?;
            page.evaluate("(() => ({commandLine:document.querySelector('#command_line')?.textContent||'',profilePath:document.querySelector('#profile_path')?.textContent||''}))()",None::<&()>).await.map_err(error)
        }.await;
        let _ = page.close().await;
        result
    }
    async fn restore_storage_state(&self, state: Value) -> Result<(), EngineError> {
        let typed = serde_json::from_value(state).map_err(error)?;
        self.context.set_storage_state(typed).await.map_err(error)
    }
    async fn export_storage_state(&self) -> Result<Value, EngineError> {
        serde_json::to_value(self.context.storage_state(None).await.map_err(error)?).map_err(error)
    }
    async fn screenshot(&self) -> Result<Vec<u8>, EngineError> {
        self.page.screenshot(None).await.map_err(error)
    }
    async fn pdf(&self, options: PdfOptions) -> Result<Vec<u8>, EngineError> {
        let mut typed = playwright_rs::protocol::PdfOptions::default();
        typed.format = options.format;
        typed.print_background = Some(options.print_background);
        typed.scale = options.scale;
        typed.path = options.path.map(Into::into);
        typed.margin = Some(playwright_rs::protocol::PdfMargin {
            top: options.margin_top,
            right: options.margin_right,
            bottom: options.margin_bottom,
            left: options.margin_left,
        });
        self.page.pdf(typed).await.map_err(error)
    }
    async fn bring_to_front(&self) -> Result<(), EngineError> {
        self.page.bring_to_front().await.map_err(error)
    }
    async fn wait_for_navigation(&self, t: u64) -> Result<(), EngineError> {
        tokio::time::timeout(
            std::time::Duration::from_millis(t),
            self.page.wait_for_load_state(None),
        )
        .await
        .map_err(|_| EngineError::Timeout("navigation".into()))?
        .map_err(error)
    }
    async fn keyboard_press(&self, k: &str) -> Result<(), EngineError> {
        self.page.keyboard().press(k, None).await.map_err(error)
    }
    async fn keyboard_type(&self, t: &str) -> Result<(), EngineError> {
        self.page.keyboard().type_text(t, None).await.map_err(error)
    }
    async fn keyboard_down(&self, k: &str) -> Result<(), EngineError> {
        self.page.keyboard().down(k).await.map_err(error)
    }
    async fn keyboard_up(&self, k: &str) -> Result<(), EngineError> {
        self.page.keyboard().up(k).await.map_err(error)
    }
}
