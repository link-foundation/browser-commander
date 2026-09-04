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
use crate::browser::node_bridge::NodeBridgePage;
use crate::core::constants::CHROME_ARGS;
use crate::core::engine::{EngineAdapter, EngineType};
use crate::fingerprint::automation_parity::{
    apply_automation_parity_args, parity_ignored_default_args,
};

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
    /// Additional Chrome arguments appended after the compatibility `args`.
    pub extra_args: Vec<String>,
    /// Browser Commander default arguments to omit.
    pub ignore_default_args: Vec<String>,
    /// Omit every Browser Commander and engine default argument.
    pub ignore_all_default_args: bool,
    /// Installed browser channel for Playwright/Puppeteer (for example, `chrome`).
    pub channel: Option<String>,
    /// Explicit path to a Chrome or Chromium executable.
    pub executable_path: Option<PathBuf>,
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
    /// Node.js executable for Playwright/Puppeteer fallback engines.
    pub node_executable: Option<PathBuf>,
    /// Working directory used to resolve Playwright/Puppeteer Node packages.
    pub node_working_dir: Option<PathBuf>,
    /// Keep `navigator.webdriver` false and the command line free of switches a
    /// hand-started Chrome does not carry.
    ///
    /// Defaults to `true`. Set to `false` to launch with the engine's own
    /// defaults, which is what the parity tests use as a negative control.
    pub automation_parity: bool,
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
            extra_args: Vec::new(),
            ignore_default_args: Vec::new(),
            ignore_all_default_args: false,
            channel: None,
            executable_path: None,
            color_scheme: None,
            launch_timeout: None,
            sandbox: true,
            node_executable: None,
            node_working_dir: None,
            automation_parity: true,
        }
    }
}

impl LaunchOptions {
    /// Set the browser automation engine.
    pub fn engine(mut self, engine: EngineType) -> Self {
        self.engine = engine;
        if engine == EngineType::Playwright && self.slow_mo == 0 {
            self.slow_mo = 150;
        }
        self
    }

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

    /// Create options for Playwright through the Node.js CLI bridge.
    pub fn playwright() -> Self {
        Self {
            engine: EngineType::Playwright,
            slow_mo: 150,
            ..Default::default()
        }
    }

    /// Create options for Puppeteer through the Node.js CLI bridge.
    pub fn puppeteer() -> Self {
        Self {
            engine: EngineType::Puppeteer,
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

    /// Add Chrome arguments after the compatibility `args` field.
    pub fn with_extra_args(mut self, args: Vec<String>) -> Self {
        self.extra_args = args;
        self
    }

    /// Omit selected Browser Commander defaults.
    pub fn ignore_default_args(mut self, args: Vec<String>) -> Self {
        self.ignore_default_args = args;
        self
    }

    /// Omit every Browser Commander and engine default argument.
    pub fn ignore_all_default_args(mut self) -> Self {
        self.ignore_all_default_args = true;
        self
    }

    /// Select an installed browser channel for Playwright or Puppeteer.
    pub fn channel(mut self, channel: impl Into<String>) -> Self {
        self.channel = Some(channel.into());
        self
    }

    /// Select an explicit Chrome or Chromium executable.
    pub fn executable_path(mut self, executable_path: impl Into<PathBuf>) -> Self {
        self.executable_path = Some(executable_path.into());
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

    /// Override the Node.js executable used by Playwright/Puppeteer engines.
    pub fn node_executable(mut self, executable: impl Into<PathBuf>) -> Self {
        self.node_executable = Some(executable.into());
        self
    }

    /// Set the directory where Node resolves `playwright` or `puppeteer`.
    pub fn node_working_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.node_working_dir = Some(dir.into());
        self
    }

    /// Turn fingerprint parity with a hand-started Chrome on or off.
    pub fn automation_parity(mut self, automation_parity: bool) -> Self {
        self.automation_parity = automation_parity;
        self
    }

    /// Get all Chrome arguments (default + custom).
    pub fn all_chrome_args(&self) -> Vec<String> {
        let mut all_args: Vec<String> = if self.ignore_all_default_args {
            Vec::new()
        } else {
            CHROME_ARGS
                .iter()
                .filter(|argument| {
                    !self
                        .ignore_default_args
                        .iter()
                        .any(|item| item == **argument)
                })
                .map(|argument| argument.to_string())
                .collect()
        };
        all_args.extend(self.args.clone());
        all_args.extend(self.extra_args.clone());
        if self.automation_parity {
            all_args = apply_automation_parity_args(&all_args);
        }
        all_args
    }

    /// Engine default switches to suppress so the command line matches a
    /// hand-started Chrome.
    ///
    /// Merged with the caller's `ignore_default_args`, because a switch the
    /// engine appends after the caller's arguments cannot be countered by
    /// passing a different value for it.
    pub fn all_ignored_default_args(&self) -> Vec<String> {
        let mut ignored = if self.automation_parity {
            parity_ignored_default_args(self.engine, self.headless)
        } else {
            Vec::new()
        };
        for argument in &self.ignore_default_args {
            if !ignored.contains(argument) {
                ignored.push(argument.clone());
            }
        }
        ignored
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
    /// For `Chromiumoxide`, this is a [`ChromiumoxidePage`]
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
/// For the `Playwright` and `Puppeteer` engines, this starts a local Node.js
/// subprocess and uses the official Node package as a CLI bridge. The selected
/// package must be available to Node module resolution, usually by running
/// `npm install playwright` or `npm install puppeteer` in the configured
/// `node_working_dir`.
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
        EngineType::Playwright | EngineType::Puppeteer => {
            launch_node_bridge(options, user_data_dir).await
        }
        EngineType::Fantoccini => Err(anyhow::anyhow!(
            "fantoccini engine launch is not yet implemented; \
             connect to an existing WebDriver session or use EngineType::Chromiumoxide"
        )),
    }
}

async fn launch_node_bridge(
    options: LaunchOptions,
    user_data_dir: PathBuf,
) -> Result<LaunchResult, anyhow::Error> {
    let engine = options.engine;
    let headless = options.headless;
    let adapter = NodeBridgePage::launch(options, user_data_dir.clone()).await?;

    Ok(LaunchResult {
        browser: Browser {
            engine,
            user_data_dir,
            headless,
        },
        page: Arc::new(adapter),
    })
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

    // Chromiumoxide only exposes an all-or-nothing switch for its own default
    // layer. Disable that layer whenever the caller requests an omission so an
    // engine-provided duplicate cannot silently re-add the selected flag.
    if options.ignore_all_default_args || !options.all_ignored_default_args().is_empty() {
        builder = builder.disable_default_args();
    }

    if !options.sandbox {
        builder = builder.no_sandbox();
    }

    if let Some(ref executable_path) = options.executable_path {
        builder = builder.chrome_executable(executable_path);
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
    use crate::fingerprint::automation_parity::{
        AUTOMATION_CONTROLLED_OFF_ARG, PLAYWRIGHT_HEADLESS_POINTER_ARG,
    };

    #[test]
    fn launch_options_default() {
        let options = LaunchOptions::default();
        assert_eq!(options.engine, EngineType::Chromiumoxide);
        assert!(!options.headless);
        assert_eq!(options.slow_mo, 0);
        assert!(!options.verbose);
        assert!(options.args.is_empty());
        assert!(options.extra_args.is_empty());
        assert!(options.ignore_default_args.is_empty());
        assert!(!options.ignore_all_default_args);
        assert!(options.automation_parity);
        assert!(options.channel.is_none());
        assert!(options.executable_path.is_none());
        assert!(options.node_executable.is_none());
        assert!(options.node_working_dir.is_none());
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
    fn launch_options_playwright() {
        let options = LaunchOptions::playwright();
        assert_eq!(options.engine, EngineType::Playwright);
        assert_eq!(options.slow_mo, 150);
    }

    #[test]
    fn launch_options_puppeteer() {
        let options = LaunchOptions::puppeteer();
        assert_eq!(options.engine, EngineType::Puppeteer);
    }

    #[test]
    fn launch_options_node_bridge_configuration() {
        let options = LaunchOptions::playwright()
            .node_executable("/custom/node")
            .node_working_dir("/project/js")
            .channel("chrome-beta")
            .executable_path("/opt/google/chrome-beta");

        assert_eq!(options.node_executable, Some(PathBuf::from("/custom/node")));
        assert_eq!(options.node_working_dir, Some(PathBuf::from("/project/js")));
        assert_eq!(options.channel.as_deref(), Some("chrome-beta"));
        assert_eq!(
            options.executable_path,
            Some(PathBuf::from("/opt/google/chrome-beta"))
        );
    }

    #[test]
    fn all_chrome_args_includes_defaults() {
        let options = LaunchOptions::default();
        let args = options.all_chrome_args();

        assert!(args.contains(&"--disable-infobars".to_string()));
        assert!(args.contains(&"--password-store=basic".to_string()));
        assert!(args.contains(&"--no-first-run".to_string()));
    }

    #[test]
    fn all_chrome_args_appends_extra_args_and_ignores_selected_defaults() {
        let options = LaunchOptions::default()
            .with_args(vec!["--legacy-arg".to_string()])
            .with_extra_args(vec!["--lang=en-US".to_string()])
            .ignore_default_args(vec!["--no-default-browser-check".to_string()]);

        let args = options.all_chrome_args();
        assert!(args.contains(&"--password-store=basic".to_string()));
        assert!(!args.contains(&"--no-default-browser-check".to_string()));
        assert_eq!(
            &args[args.len() - 3..],
            [
                "--legacy-arg".to_string(),
                "--lang=en-US".to_string(),
                AUTOMATION_CONTROLLED_OFF_ARG.to_string()
            ]
        );
    }

    #[test]
    fn all_chrome_args_can_ignore_every_default() {
        let options = LaunchOptions::default()
            .ignore_all_default_args()
            .with_extra_args(vec!["--lang=en-US".to_string()]);

        assert_eq!(
            options.all_chrome_args(),
            [
                "--lang=en-US".to_string(),
                AUTOMATION_CONTROLLED_OFF_ARG.to_string()
            ]
        );
    }

    #[test]
    fn all_chrome_args_can_ignore_password_store_default_specifically() {
        let options = LaunchOptions::default()
            .ignore_default_args(vec!["--password-store=basic".to_string()]);

        let args = options.all_chrome_args();
        assert!(!args.contains(&"--password-store=basic".to_string()));
        assert!(args.contains(&"--no-first-run".to_string()));
    }

    #[test]
    fn all_chrome_args_includes_custom() {
        let options = LaunchOptions::default().with_args(vec!["--custom".to_string()]);
        let args = options.all_chrome_args();

        assert!(args.contains(&"--custom".to_string()));
    }

    #[test]
    fn all_chrome_args_disables_the_automation_controlled_feature() {
        let args = LaunchOptions::default().all_chrome_args();
        assert_eq!(
            args.last().map(String::as_str),
            Some(AUTOMATION_CONTROLLED_OFF_ARG)
        );
    }

    #[test]
    fn all_chrome_args_leaves_the_command_line_alone_when_parity_is_off() {
        let args = LaunchOptions::default()
            .automation_parity(false)
            .all_chrome_args();
        assert!(!args
            .iter()
            .any(|argument| argument == AUTOMATION_CONTROLLED_OFF_ARG));
    }

    #[test]
    fn all_ignored_default_args_merges_parity_with_the_caller_list() {
        let options = LaunchOptions::playwright()
            .headless(true)
            .ignore_default_args(vec!["--no-first-run".to_string()]);

        assert_eq!(
            options.all_ignored_default_args(),
            [
                "--enable-automation".to_string(),
                PLAYWRIGHT_HEADLESS_POINTER_ARG.to_string(),
                "--no-first-run".to_string()
            ]
        );
    }

    #[test]
    fn all_ignored_default_args_does_not_repeat_a_switch_the_caller_already_listed() {
        let options = LaunchOptions::playwright()
            .ignore_default_args(vec!["--enable-automation".to_string()]);

        assert_eq!(
            options.all_ignored_default_args(),
            ["--enable-automation".to_string()]
        );
    }

    #[test]
    fn all_ignored_default_args_keeps_only_the_caller_list_when_parity_is_off() {
        let options = LaunchOptions::playwright()
            .headless(true)
            .automation_parity(false)
            .ignore_default_args(vec!["--no-first-run".to_string()]);

        assert_eq!(
            options.all_ignored_default_args(),
            ["--no-first-run".to_string()]
        );
    }

    #[test]
    fn chromiumoxide_excludes_nothing_by_default() {
        assert!(LaunchOptions::chromiumoxide()
            .all_ignored_default_args()
            .is_empty());
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

    #[tokio::test]
    async fn launch_playwright_reports_missing_node_executable() {
        let options = LaunchOptions::playwright()
            .headless(true)
            .node_executable("browser-commander-missing-node");
        let err = launch_browser(options).await.unwrap_err();
        assert!(err.to_string().contains("failed to start Node.js bridge"));
    }
}
