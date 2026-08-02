//! Connect to an already-running Chromium-family browser over CDP.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use chromiumoxide::browser::Browser as CdpBrowser;
use chromiumoxide::cdp::browser_protocol::network::CookieParam;
use futures::StreamExt;
use serde_json::Value;

use crate::browser::chromiumoxide_adapter::ChromiumoxidePage;
use crate::browser::launcher::{Browser, LaunchResult};
use crate::browser::node_bridge::NodeBridgePage;
use crate::core::engine::EngineType;

/// Options for attaching to a running browser over CDP.
#[derive(Debug, Clone)]
pub struct ConnectOptions {
    /// Browser automation engine used for the connection.
    pub engine: EngineType,
    /// HTTP DevTools endpoint, for example `http://127.0.0.1:9222`.
    pub cdp_endpoint: Option<String>,
    /// DevTools browser WebSocket endpoint.
    pub ws_endpoint: Option<String>,
    /// Slow down Playwright/Puppeteer operations by this many milliseconds.
    pub slow_mo: u64,
    /// Optional connection timeout.
    pub timeout: Option<Duration>,
    /// Optional Puppeteer timeout for individual CDP calls.
    pub protocol_timeout: Option<Duration>,
    /// Cookies to seed after attaching, in CDP/Playwright cookie format.
    pub seed_cookies: Vec<Value>,
    /// Enable verbose bridge logging.
    pub verbose: bool,
    /// Node.js executable for Playwright/Puppeteer bridge engines.
    pub node_executable: Option<PathBuf>,
    /// Directory where Node resolves the Playwright/Puppeteer package.
    pub node_working_dir: Option<PathBuf>,
}

impl Default for ConnectOptions {
    fn default() -> Self {
        Self {
            engine: EngineType::Chromiumoxide,
            cdp_endpoint: None,
            ws_endpoint: None,
            slow_mo: 0,
            timeout: None,
            protocol_timeout: None,
            seed_cookies: Vec::new(),
            verbose: false,
            node_executable: None,
            node_working_dir: None,
        }
    }
}

impl ConnectOptions {
    /// Create Chromiumoxide connection options.
    pub fn chromiumoxide() -> Self {
        Self::default()
    }

    /// Create Playwright bridge connection options.
    pub fn playwright() -> Self {
        Self {
            engine: EngineType::Playwright,
            ..Self::default()
        }
    }

    /// Create Puppeteer bridge connection options.
    pub fn puppeteer() -> Self {
        Self {
            engine: EngineType::Puppeteer,
            ..Self::default()
        }
    }

    /// Select an HTTP DevTools endpoint.
    pub fn cdp_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.cdp_endpoint = Some(endpoint.into());
        self
    }

    /// Select a DevTools browser WebSocket endpoint.
    pub fn ws_endpoint(mut self, endpoint: impl Into<String>) -> Self {
        self.ws_endpoint = Some(endpoint.into());
        self
    }

    /// Set the engine operation delay.
    pub fn slow_mo(mut self, milliseconds: u64) -> Self {
        self.slow_mo = milliseconds;
        self
    }

    /// Set the connection timeout.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Set Puppeteer's timeout for individual CDP calls.
    pub fn protocol_timeout(mut self, timeout: Duration) -> Self {
        self.protocol_timeout = Some(timeout);
        self
    }

    /// Seed cookies immediately after the connection is established.
    pub fn seed_cookies(mut self, cookies: Vec<Value>) -> Self {
        self.seed_cookies = cookies;
        self
    }

    /// Enable verbose connection logging.
    pub fn verbose(mut self, verbose: bool) -> Self {
        self.verbose = verbose;
        self
    }

    /// Override the Node.js executable for bridge engines.
    pub fn node_executable(mut self, executable: impl Into<PathBuf>) -> Self {
        self.node_executable = Some(executable.into());
        self
    }

    /// Set the directory where Node resolves Playwright or Puppeteer.
    pub fn node_working_dir(mut self, directory: impl Into<PathBuf>) -> Self {
        self.node_working_dir = Some(directory.into());
        self
    }

    pub(crate) fn endpoint(&self) -> Result<&str, anyhow::Error> {
        match (&self.cdp_endpoint, &self.ws_endpoint) {
            (Some(endpoint), None) | (None, Some(endpoint)) if !endpoint.is_empty() => Ok(endpoint),
            _ => Err(anyhow::anyhow!(
                "connect_browser requires exactly one of cdp_endpoint or ws_endpoint"
            )),
        }
    }
}

/// Attach to a running Chromium-family browser over CDP.
///
/// Chromiumoxide connects natively. Playwright and Puppeteer use the same
/// official Node.js packages as [`launch_browser`](super::launcher::launch_browser).
/// The returned page implements the crate's shared [`EngineAdapter`](crate::core::EngineAdapter)
/// API. The browser's profile and process remain externally managed.
pub async fn connect_browser(options: ConnectOptions) -> Result<LaunchResult, anyhow::Error> {
    let endpoint = options.endpoint()?.to_string();
    if options.verbose {
        tracing::info!(engine = %options.engine, %endpoint, "connecting to browser");
    }

    match options.engine {
        EngineType::Chromiumoxide => connect_chromiumoxide(options, endpoint).await,
        EngineType::Playwright | EngineType::Puppeteer => {
            let engine = options.engine;
            let timeout = options.timeout;
            let connection = NodeBridgePage::connect(options);
            let page = if let Some(timeout) = timeout {
                tokio::time::timeout(timeout, connection)
                    .await
                    .map_err(|_| anyhow::anyhow!("timed out connecting to browser"))??
            } else {
                connection.await?
            };
            Ok(LaunchResult {
                browser: Browser {
                    engine,
                    user_data_dir: PathBuf::new(),
                    headless: false,
                },
                page: Arc::new(page),
            })
        }
        EngineType::Fantoccini => Err(anyhow::anyhow!(
            "fantoccini does not connect over CDP; use chromiumoxide, playwright, or puppeteer"
        )),
    }
}

async fn connect_chromiumoxide(
    options: ConnectOptions,
    endpoint: String,
) -> Result<LaunchResult, anyhow::Error> {
    let connection = CdpBrowser::connect(endpoint);
    let (browser, mut handler) = if let Some(timeout) = options.timeout {
        tokio::time::timeout(timeout, connection)
            .await
            .map_err(|_| anyhow::anyhow!("timed out connecting to browser"))??
    } else {
        connection.await?
    };

    let handler_task = tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            if let Err(error) = event {
                tracing::debug!(%error, "chromiumoxide handler event error");
            }
        }
    });

    if !options.seed_cookies.is_empty() {
        let cookies = options
            .seed_cookies
            .iter()
            .cloned()
            .map(serde_json::from_value::<CookieParam>)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| anyhow::anyhow!("invalid seed cookie: {error}"))?;
        browser.set_cookies(cookies).await?;
    }

    let page = match browser.pages().await?.into_iter().next() {
        Some(page) => page,
        None => browser.new_page("about:blank").await?,
    };
    let engine = options.engine;
    let adapter = ChromiumoxidePage::new(page, browser, handler_task, PathBuf::new());

    Ok(LaunchResult {
        browser: Browser {
            engine,
            user_data_dir: PathBuf::new(),
            headless: false,
        },
        page: Arc::new(adapter),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn connect_options_builders_preserve_endpoints_and_cookies() {
        let cookies = vec![json!({"name": "SID", "value": "saved", "domain": ".example.com"})];
        let options = ConnectOptions::playwright()
            .cdp_endpoint("http://127.0.0.1:9222")
            .slow_mo(25)
            .seed_cookies(cookies.clone())
            .node_working_dir("../js");

        assert_eq!(options.engine, EngineType::Playwright);
        assert_eq!(options.endpoint().unwrap(), "http://127.0.0.1:9222");
        assert_eq!(options.slow_mo, 25);
        assert_eq!(options.seed_cookies, cookies);
        assert_eq!(options.node_working_dir, Some(PathBuf::from("../js")));
    }

    #[test]
    fn connect_options_require_exactly_one_endpoint() {
        assert!(ConnectOptions::default().endpoint().is_err());
        assert!(ConnectOptions::puppeteer()
            .cdp_endpoint("http://127.0.0.1:9222")
            .ws_endpoint("ws://127.0.0.1:9222/devtools/browser/id")
            .endpoint()
            .is_err());
    }
}
