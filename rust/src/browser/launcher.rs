//! Browser launcher for browser automation.
//!
//! This module provides utilities for launching browser instances
//! with appropriate configuration.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use chromiumoxide::browser::{Browser as CdpBrowser, BrowserConfig, HeadlessMode};
use futures::StreamExt;

use crate::browser::chromiumoxide_adapter::ChromiumoxidePage;
use crate::browser::media::ColorScheme;
use crate::core::constants::CHROME_ARGS;
use crate::core::engine::{EngineAdapter, EngineType};

/// Options for launching a browser.
#[derive(Debug, Clone)]
pub struct LaunchOptions {
    /// The browser engine to use.
    pub engine: EngineType,
    /// Path to user data directory.
    pub user_data_dir: Option<PathBuf>,
    /// Run in headless mode.
    pub headless: bool,
    /// Slow down operations by this many milliseconds.
    pub slow_mo: u64,
    /// Enable verbose logging.
    pub verbose: bool,
    /// Additional Chrome arguments.
    pub args: Vec<String>,
    /// Color scheme to emulate. `None` uses the system default.
    pub color_scheme: Option<ColorScheme>,
    /// Optional timeout for the browser launch handshake.
    pub launch_timeout: Option<Duration>,
    /// Whether to run the browser with the Chromium sandbox enabled.
    ///
    /// Defaults to `true`. Disable when running in environments where the
    /// sandbox is unavailable (e.g. CI containers without the required
    /// capabilities). This translates to the `--no-sandbox` /
    /// `--disable-setuid-sandbox` Chromium flags.
    pub sandbox: bool,
}

impl Default for LaunchOptions {
    fn default() -> Self {
        Self {
            engine: EngineType::Chromiumoxide,
            user_data_dir: None,
            headless: false,
            slow_mo: 0,
            verbose: false,
            args: Vec::new(),
            color_scheme: None,
            launch_timeout: None,
            sandbox: true,
        }
    }
}

impl LaunchOptions {
    /// Create options for chromiumoxide engine.
    pub fn chromiumoxide() -> Self {
        Self {
            engine: EngineType::Chromiumoxide,
            ..Default::default()
        }
    }

    /// Create options for fantoccini (WebDriver) engine.
    pub fn fantoccini() -> Self {
        Self {
            engine: EngineType::Fantoccini,
            ..Default::default()
        }
    }

    /// Set headless mode.
    pub fn headless(mut self, headless: bool) -> Self {
        self.headless = headless;
        self
    }

    /// Set the user data directory.
    pub fn user_data_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.user_data_dir = Some(dir.into());
        self
    }

    /// Set slow motion delay.
    pub fn slow_mo(mut self, ms: u64) -> Self {
        self.slow_mo = ms;
        self
    }

    /// Enable verbose logging.
    pub fn verbose(mut self, verbose: bool) -> Self {
        self.verbose = verbose;
        self
    }

    /// Add additional Chrome arguments.
    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }

    /// Set the color scheme for media emulation.
    pub fn color_scheme(mut self, color_scheme: ColorScheme) -> Self {
        self.color_scheme = Some(color_scheme);
        self
    }

    /// Override the browser launch timeout.
    pub fn launch_timeout(mut self, timeout: Duration) -> Self {
        self.launch_timeout = Some(timeout);
        self
    }

    /// Enable or disable the Chromium sandbox for the launched browser.
    pub fn sandbox(mut self, sandbox: bool) -> Self {
        self.sandbox = sandbox;
        self
    }

    /// Get all Chrome arguments (default + custom).
    pub fn all_chrome_args(&self) -> Vec<String> {
        let mut all_args: Vec<String> = CHROME_ARGS.iter().map(|s| s.to_string()).collect();
        all_args.extend(self.args.clone());
        all_args
    }

    /// Get the user data directory, using a default if not specified.
    pub fn get_user_data_dir(&self) -> PathBuf {
        if let Some(ref dir) = self.user_data_dir {
            dir.clone()
        } else {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            home.join(".browser-commander")
                .join(format!("{}-data", self.engine))
        }
    }
}

/// Browser metadata returned alongside a launched page.
#[derive(Debug, Clone)]
pub struct Browser {
    /// The engine type being used.
    pub engine: EngineType,
    /// The user data directory.
    pub user_data_dir: PathBuf,
    /// Whether the browser is running headless.
    pub headless: bool,
}

/// Result of a browser launch.
///
/// Contains both static metadata (`browser`) and a live
/// [`EngineAdapter`] (`page`) that can be passed to the navigation,
/// interaction, and query helpers exposed by this crate.
pub struct LaunchResult {
    /// The browser metadata.
    pub browser: Browser,
    /// A live page/adapter tied to the launched browser.
    ///
    /// For `Chromiumoxide`, this is a [`ChromiumoxidePage`](crate::browser::ChromiumoxidePage)
    /// implementing [`EngineAdapter`]. Pass `launch_result.page.as_ref()` to
    /// `goto`, `click`, `evaluate`, and other helpers.
    pub page: Arc<dyn EngineAdapter>,
}

impl std::fmt::Debug for LaunchResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LaunchResult")
            .field("browser", &self.browser)
            .field("page", &"<dyn EngineAdapter>")
            .finish()
    }
}

/// Launch a browser with the given options.
///
/// For the `Chromiumoxide` engine, this starts a Chromium process, waits for
/// the CDP handshake, opens a blank page, and returns a [`LaunchResult`]
/// containing both the metadata (`browser`) and a live page adapter (`page`)
/// implementing [`EngineAdapter`].
///
/// The `Fantoccini` engine is not yet implemented as a managed launcher; use
/// chromiumoxide or connect to an externally-managed WebDriver session.
///
/// # Arguments
///
/// * `options` - Launch options
///
/// # Returns
///
/// The launch result containing the browser metadata and a page adapter
///
/// # Errors
///
/// Returns an error if the browser fails to launch.
pub async fn launch_browser(options: LaunchOptions) -> Result<LaunchResult, anyhow::Error> {
    if options.verbose {
        tracing::info!("Launching browser with {} engine...", options.engine);
    }

    let user_data_dir = options.get_user_data_dir();
    std::fs::create_dir_all(&user_data_dir)?;

    match options.engine {
        EngineType::Chromiumoxide => launch_chromiumoxide(options, user_data_dir).await,
        EngineType::Fantoccini => Err(anyhow::anyhow!(
            "fantoccini engine launch is not yet implemented; \
             connect to an existing WebDriver session or use EngineType::Chromiumoxide"
        )),
    }
}

async fn launch_chromiumoxide(
    options: LaunchOptions,
    user_data_dir: PathBuf,
) -> Result<LaunchResult, anyhow::Error> {
    let headless_mode = if options.headless {
        HeadlessMode::New
    } else {
        HeadlessMode::False
    };

    let mut builder = BrowserConfig::builder()
        .user_data_dir(&user_data_dir)
        .headless_mode(headless_mode)
        .args(options.all_chrome_args());

    if !options.sandbox {
        builder = builder.no_sandbox();
    }

    if let Some(timeout) = options.launch_timeout {
        builder = builder.launch_timeout(timeout);
    }

    let config = builder
        .build()
        .map_err(|e| anyhow::anyhow!("failed to build browser config: {}", e))?;

    let (browser, mut handler) = CdpBrowser::launch(config)
        .await
        .map_err(|e| anyhow::anyhow!("failed to launch chromium: {}", e))?;

    // Drain the CDP event stream on a background task. Dropping the handler
    // causes the browser to hang, so we must keep polling it for the lifetime
    // of the browser. Errors are logged but do not abort the task — the CDP
    // channel naturally returns errors once the browser is closed.
    let handler_task = tokio::spawn(async move {
        while let Some(event) = handler.next().await {
            if let Err(err) = event {
                tracing::debug!(error = %err, "chromiumoxide handler event error");
            }
        }
    });

    let page = browser
        .new_page("about:blank")
        .await
        .map_err(|e| anyhow::anyhow!("failed to open initial page: {}", e))?;

    let engine = options.engine;
    let headless = options.headless;
    let color_scheme = options.color_scheme.clone();

    let adapter = ChromiumoxidePage::new(page, browser, handler_task, user_data_dir.clone());

    // Apply color scheme emulation (best-effort).
    if let Some(ref cs) = color_scheme {
        if let Err(err) = adapter.set_color_scheme(Some(cs)).await {
            if options.verbose {
                tracing::warn!(error = %err, "could not set color scheme");
            }
        }
    }

    // Bring the page to front so the address bar is not focused when running
    // headful — mirrors the JS launcher's behavior.
    if !headless {
        if let Err(err) = adapter.bring_to_front().await {
            if options.verbose {
                tracing::debug!(error = %err, "bring_to_front failed");
            }
        }
    }

    if options.verbose {
        tracing::info!("Browser launched with {} engine", engine);
    }

    Ok(LaunchResult {
        browser: Browser {
            engine,
            user_data_dir,
            headless,
        },
        page: Arc::new(adapter),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_options_default() {
        let options = LaunchOptions::default();
        assert_eq!(options.engine, EngineType::Chromiumoxide);
        assert!(!options.headless);
        assert_eq!(options.slow_mo, 0);
        assert!(!options.verbose);
        assert!(options.args.is_empty());
    }

    #[test]
    fn launch_options_builder() {
        let options = LaunchOptions::chromiumoxide()
            .headless(true)
            .slow_mo(100)
            .verbose(true)
            .with_args(vec!["--custom-arg".to_string()]);

        assert_eq!(options.engine, EngineType::Chromiumoxide);
        assert!(options.headless);
        assert_eq!(options.slow_mo, 100);
        assert!(options.verbose);
        assert_eq!(options.args, vec!["--custom-arg"]);
    }

    #[test]
    fn launch_options_fantoccini() {
        let options = LaunchOptions::fantoccini();
        assert_eq!(options.engine, EngineType::Fantoccini);
    }

    #[test]
    fn all_chrome_args_includes_defaults() {
        let options = LaunchOptions::default();
        let args = options.all_chrome_args();

        assert!(args.contains(&"--disable-infobars".to_string()));
        assert!(args.contains(&"--no-first-run".to_string()));
    }

    #[test]
    fn all_chrome_args_includes_custom() {
        let options = LaunchOptions::default().with_args(vec!["--custom".to_string()]);
        let args = options.all_chrome_args();

        assert!(args.contains(&"--custom".to_string()));
    }

    #[test]
    fn get_user_data_dir_uses_custom() {
        let options = LaunchOptions::default().user_data_dir("/custom/path");
        assert_eq!(options.get_user_data_dir(), PathBuf::from("/custom/path"));
    }

    #[test]
    fn get_user_data_dir_creates_default() {
        let options = LaunchOptions::default();
        let dir = options.get_user_data_dir();
        assert!(dir.to_string_lossy().contains("browser-commander"));
        assert!(dir.to_string_lossy().contains("chromiumoxide-data"));
    }

    #[tokio::test]
    async fn launch_fantoccini_is_unimplemented() {
        let options = LaunchOptions::fantoccini();
        let err = launch_browser(options).await.unwrap_err();
        assert!(err.to_string().contains("fantoccini"));
    }
}
