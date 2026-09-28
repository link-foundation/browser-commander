//! Browser launcher for browser automation.
//!
//! By default ([`LaunchMode::Real`]) Browser Commander starts the installed
//! Chrome itself, exactly like a person who wants to attach a debugger would,
//! and attaches the engine over CDP (issues #101 and #103).
//! [`LaunchMode::Engine`] keeps the engine-launched browser for CI and
//! headless use. Mirrors `js/src/browser/launcher.js`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::browser::browser_process::{BrowserCloser, BrowserProcess};
use crate::browser::connector::{
    connect_browser_with, refuse_unappliable_fingerprint, AttachSettings,
};
use crate::browser::engine_launch::launch_with_engine;
use crate::browser::launch_executable::DefaultLaunchHooks;
use crate::browser::media::ColorScheme;
use crate::browser::real_browser::{launch_real_browser_with, RealBrowserOptions};
use crate::browser::restrictions::{merge_feature_switches, resolve_restrictions};
use crate::core::engine::{EngineAdapter, EngineType};
use crate::downloads::{normalize_download_options, supported_engine};
use crate::downloads::{DownloadManager, DownloadSetting};
use crate::fingerprint::automation_parity::{
    apply_automation_parity_args, parity_ignored_default_args,
};
use crate::fingerprint::profile::FingerprintProfile;

/// Who starts the browser (issue #103).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum LaunchMode {
    /// Browser Commander starts the installed browser with a hand-started
    /// command line - `--user-data-dir=<fresh profile>
    /// --remote-debugging-port=<reserved port>` - and attaches the engine.
    #[default]
    Real,
    /// The automation engine starts the browser with its own switches, which
    /// `limitations.json` lists (`engine-launch-switches`).
    Engine,
}

/// Every [`LaunchMode`], matching the JavaScript `LAUNCH_MODES`.
pub const LAUNCH_MODES: [LaunchMode; 2] = [LaunchMode::Real, LaunchMode::Engine];

impl LaunchMode {
    /// The name shared with the JavaScript and Python packages.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Real => "real",
            Self::Engine => "engine",
        }
    }
}

impl std::fmt::Display for LaunchMode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for LaunchMode {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        LAUNCH_MODES
            .into_iter()
            .find(|mode| mode.as_str() == value)
            .ok_or_else(|| {
                anyhow::anyhow!("Invalid launch mode: {value}. Expected 'real' or 'engine'")
            })
    }
}

/// Options for launching a browser.
#[derive(Debug, Clone)]
pub struct LaunchOptions {
    /// The browser engine to use.
    pub engine: EngineType,
    /// Who starts the browser; [`LaunchMode::Real`] by default.
    pub launch: LaunchMode,
    /// Persistent profile directory. When `None` a fresh temporary profile is
    /// created for the launch and deleted by [`LaunchResult::close`].
    pub user_data_dir: Option<PathBuf>,
    /// Run in headless mode.
    pub headless: bool,
    /// Slow down operations by this many milliseconds (default 0).
    pub slow_mo: u64,
    /// Enable verbose logging.
    pub verbose: bool,
    /// Opt-in restrictions from `launch-restrictions.json`, such as
    /// `no-extensions` or the `legacy-defaults` preset (issue #103).
    pub restrictions: Vec<String>,
    /// Additional Chrome arguments.
    pub args: Vec<String>,
    /// Additional Chrome arguments appended after the compatibility `args`.
    pub extra_args: Vec<String>,
    /// Engine default switches to omit ([`LaunchMode::Engine`] only).
    pub ignore_default_args: Vec<String>,
    /// Omit every engine default switch ([`LaunchMode::Engine`] only).
    pub ignore_all_default_args: bool,
    /// Extra environment for the browser process only; the parent's
    /// environment is never modified.
    pub env: Option<HashMap<String, String>>,
    /// Installed browser channel, such as `chrome`, `chrome-beta`, `msedge`,
    /// `brave` or `chromium`.
    pub channel: Option<String>,
    /// Explicit path to a Chrome or Chromium executable.
    pub executable_path: Option<PathBuf>,
    /// Fixed CDP port for the real launch; a free one is reserved when `None`.
    pub remote_debugging_port: Option<u16>,
    /// Color scheme to emulate. `None` uses the system default.
    pub color_scheme: Option<ColorScheme>,
    /// Optional timeout for the browser launch handshake.
    pub launch_timeout: Option<Duration>,
    /// Whether to run the browser with the Chromium sandbox enabled.
    ///
    /// Defaults to `true`. Disable when running in environments where the
    /// sandbox is unavailable (e.g. CI containers without the required
    /// capabilities). This adds `--no-sandbox`.
    pub sandbox: bool,
    /// Node.js executable for Playwright/Puppeteer fallback engines.
    pub node_executable: Option<PathBuf>,
    /// Working directory used to resolve Playwright/Puppeteer Node packages.
    pub node_working_dir: Option<PathBuf>,
    /// Keep `navigator.webdriver` false where a launch switch would turn it on
    /// (headless or engine launches).
    ///
    /// Defaults to `true`. Set to `false` to launch with the engine's own
    /// defaults, which is what the parity tests use as a negative control.
    pub automation_parity: bool,
    /// The environment pages should see: user agent, time zone, locale, core
    /// count, screen and the rest.
    ///
    /// Applied over CDP once the browser is up, so it only works for the
    /// chromiumoxide engine; see
    /// [`fingerprint::profile`](crate::fingerprint::profile) for the field list
    /// and [`presets`](crate::fingerprint::presets) for ready-made machines.
    pub fingerprint: Option<FingerprintProfile>,
    /// Manage the browser's downloads: where they are saved, how they are
    /// named, and whether they outlive the browser.
    ///
    /// Downloads are redirected over CDP, so this only works for the
    /// chromiumoxide engine; the other engines refuse rather than accept a
    /// setting they cannot honor. See [`downloads`](crate::downloads).
    pub downloads: DownloadSetting,
}

impl Default for LaunchOptions {
    fn default() -> Self {
        Self {
            engine: EngineType::Chromiumoxide,
            launch: LaunchMode::Real,
            user_data_dir: None,
            headless: false,
            slow_mo: 0,
            verbose: false,
            restrictions: Vec::new(),
            args: Vec::new(),
            extra_args: Vec::new(),
            ignore_default_args: Vec::new(),
            ignore_all_default_args: false,
            env: None,
            channel: None,
            executable_path: None,
            remote_debugging_port: None,
            color_scheme: None,
            launch_timeout: None,
            sandbox: true,
            node_executable: None,
            node_working_dir: None,
            automation_parity: true,
            fingerprint: None,
            downloads: DownloadSetting::Off,
        }
    }
}

impl LaunchOptions {
    /// Set the browser automation engine.
    pub fn engine(mut self, engine: EngineType) -> Self {
        self.engine = engine;
        self
    }

    /// Create options for chromiumoxide engine.
    pub fn chromiumoxide() -> Self {
        Self::default().engine(EngineType::Chromiumoxide)
    }

    /// Create options for fantoccini (WebDriver) engine.
    pub fn fantoccini() -> Self {
        Self::default().engine(EngineType::Fantoccini)
    }

    /// Create options for Playwright through the Node.js CLI bridge.
    pub fn playwright() -> Self {
        Self::default().engine(EngineType::Playwright)
    }

    /// Create options for Puppeteer through the Node.js CLI bridge.
    pub fn puppeteer() -> Self {
        Self::default().engine(EngineType::Puppeteer)
    }

    /// Choose who starts the browser.
    pub fn launch(mut self, launch: LaunchMode) -> Self {
        self.launch = launch;
        self
    }

    /// Set headless mode.
    pub fn headless(mut self, headless: bool) -> Self {
        self.headless = headless;
        self
    }

    /// Use a persistent profile directory instead of a temporary one.
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

    /// Opt in to restrictions or presets from `launch-restrictions.json`.
    pub fn restrictions<I, S>(mut self, restrictions: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.restrictions = restrictions.into_iter().map(Into::into).collect();
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

    /// Omit selected engine default switches ([`LaunchMode::Engine`] only).
    pub fn ignore_default_args(mut self, args: Vec<String>) -> Self {
        self.ignore_default_args = args;
        self
    }

    /// Omit every engine default switch ([`LaunchMode::Engine`] only).
    pub fn ignore_all_default_args(mut self) -> Self {
        self.ignore_all_default_args = true;
        self
    }

    /// Extra environment for the browser process only.
    pub fn env(mut self, env: HashMap<String, String>) -> Self {
        self.env = Some(env);
        self
    }

    /// Select an installed browser channel.
    pub fn channel(mut self, channel: impl Into<String>) -> Self {
        self.channel = Some(channel.into());
        self
    }

    /// Select an explicit Chrome or Chromium executable.
    pub fn executable_path(mut self, executable_path: impl Into<PathBuf>) -> Self {
        self.executable_path = Some(executable_path.into());
        self
    }

    /// Use a fixed CDP port for the real launch.
    pub fn remote_debugging_port(mut self, port: u16) -> Self {
        self.remote_debugging_port = Some(port);
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

    /// Set the environment pages should see.
    pub fn fingerprint(mut self, fingerprint: FingerprintProfile) -> Self {
        self.fingerprint = Some(fingerprint);
        self
    }

    /// Manage this browser's downloads.
    ///
    /// # Arguments
    ///
    /// * `downloads` - `true` for the defaults, `false` for none, or
    ///   [`DownloadOptions`](crate::downloads::DownloadOptions)
    pub fn downloads(mut self, downloads: impl Into<DownloadSetting>) -> Self {
        self.downloads = downloads.into();
        self
    }

    /// The Chrome arguments an engine launch passes: the opt-in restrictions,
    /// then `args` and `extra_args`, with repeated feature-list switches
    /// merged and, with automation parity, the `AutomationControlled` off
    /// switch the engine's own switches need.
    ///
    /// Browser Commander adds nothing else since issue #103; the old defaults
    /// are the `legacy-defaults` restriction preset.
    ///
    /// # Errors
    ///
    /// Returns an error for an unknown restriction.
    pub fn all_chrome_args(&self) -> anyhow::Result<Vec<String>> {
        let mut args = resolve_restrictions(&self.restrictions)?.args;
        args.extend(self.args.iter().cloned());
        args.extend(self.extra_args.iter().cloned());
        let args = merge_feature_switches(&args);
        Ok(if self.automation_parity {
            apply_automation_parity_args(&args)
        } else {
            args
        })
    }

    /// Engine default switches to suppress so the command line matches a
    /// hand-started Chrome ([`LaunchMode::Engine`] only).
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

    /// The environment the browser process gets on top of the parent's: the
    /// restrictions' variables, then `env`. `None` when there is nothing to
    /// add.
    pub(crate) fn browser_env(&self) -> anyhow::Result<Option<HashMap<String, String>>> {
        let mut env = resolve_restrictions(&self.restrictions)?.env;
        if let Some(extra) = &self.env {
            env.extend(
                extra
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone())),
            );
        }
        Ok((!env.is_empty() || self.env.is_some()).then_some(env))
    }

    /// Get the user data directory, using a default if not specified.
    #[deprecated(
        since = "0.13.0",
        note = "launch_browser uses a fresh temporary profile unless user_data_dir is set; read LaunchResult::browser.user_data_dir"
    )]
    pub fn get_user_data_dir(&self) -> PathBuf {
        if let Some(ref dir) = self.user_data_dir {
            dir.clone()
        } else {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            home.join(".browser-commander")
                .join(format!("{}-data", self.engine))
        }
    }

    /// The same launch expressed as [`RealBrowserOptions`].
    pub(crate) fn real_browser_options(&self) -> RealBrowserOptions {
        let defaults = RealBrowserOptions::default();
        let mut extra_args = self.extra_args.clone();
        if !self.sandbox
            && !self
                .args
                .iter()
                .chain(&extra_args)
                .any(|a| a == "--no-sandbox")
        {
            extra_args.push("--no-sandbox".to_string());
        }
        RealBrowserOptions {
            engine: self.engine,
            channel: self.channel.clone().unwrap_or(defaults.channel.clone()),
            executable_path: self.executable_path.clone(),
            user_data_dir: self.user_data_dir.clone(),
            remote_debugging_port: self.remote_debugging_port,
            headless: self.headless,
            restrictions: self.restrictions.clone(),
            args: self.args.clone(),
            extra_args,
            env: self.env.clone(),
            automation_parity: self.automation_parity,
            startup_timeout: self.launch_timeout.unwrap_or(defaults.startup_timeout),
            slow_mo: self.slow_mo,
            verbose: self.verbose,
            node_executable: self.node_executable.clone(),
            node_working_dir: self.node_working_dir.clone(),
            downloads: self.downloads.clone(),
            ..defaults
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
/// Contains static metadata (`browser` and the launch fields), a live
/// [`EngineAdapter`] (`page`) that can be passed to the navigation,
/// interaction, and query helpers exposed by this crate, and
/// [`close`](Self::close).
pub struct LaunchResult {
    /// The browser metadata.
    pub browser: Browser,
    /// A live page/adapter tied to the launched browser.
    ///
    /// For `Chromiumoxide`, this is a
    /// [`ChromiumoxidePage`](super::chromiumoxide_adapter::ChromiumoxidePage)
    /// implementing [`EngineAdapter`]. Pass `launch_result.page.as_ref()` to
    /// `goto`, `click`, `evaluate`, and other helpers.
    pub page: Arc<dyn EngineAdapter>,
    /// The download manager, when the caller asked for managed downloads.
    ///
    /// Downloads keep arriving while the browser is open, so the manager
    /// outlives any single call: hold on to it, and call
    /// [`DownloadManager::dispose`] before closing the browser.
    pub downloads: Option<Arc<DownloadManager>>,
    /// Who started the browser; `None` for a browser attached with
    /// [`connect_browser`](super::connector::connect_browser).
    pub launch: Option<LaunchMode>,
    /// Whether `browser.user_data_dir` is a temporary profile that
    /// [`close`](Self::close) deletes.
    pub temporary_profile: bool,
    /// The Chrome arguments Browser Commander passed (the engine adds its own
    /// in [`LaunchMode::Engine`]).
    pub args: Vec<String>,
    /// The DevTools HTTP endpoint of a real launch.
    pub cdp_endpoint: Option<String>,
    /// The DevTools port of a real launch.
    pub remote_debugging_port: Option<u16>,
    /// The browser binary a real launch started, or the one requested for an
    /// engine launch.
    pub executable_path: Option<PathBuf>,
    /// The browser process of a real launch (the engine owns it otherwise).
    pub browser_process: Option<BrowserProcess>,
    closer: Option<Arc<dyn BrowserCloser>>,
}

impl LaunchResult {
    /// A browser somebody else started, attached over CDP.
    pub(crate) fn attached(
        browser: Browser,
        page: Arc<dyn EngineAdapter>,
        downloads: Option<Arc<DownloadManager>>,
    ) -> Self {
        Self {
            browser,
            page,
            downloads,
            launch: None,
            temporary_profile: false,
            args: Vec::new(),
            cdp_endpoint: None,
            remote_debugging_port: None,
            executable_path: None,
            browser_process: None,
            closer: None,
        }
    }

    /// Close the browser this launch started and delete its temporary
    /// profile. Idempotent.
    ///
    /// A browser attached with
    /// [`connect_browser`](super::connector::connect_browser) is managed by
    /// whoever started it, so this does nothing for one.
    pub async fn close(&self) -> anyhow::Result<()> {
        match &self.closer {
            Some(closer) => closer.close().await,
            None => Ok(()),
        }
    }
}

impl std::fmt::Debug for LaunchResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LaunchResult")
            .field("browser", &self.browser)
            .field("page", &"<dyn EngineAdapter>")
            .field("downloads", &self.downloads)
            .field("launch", &self.launch)
            .field("temporary_profile", &self.temporary_profile)
            .field("args", &self.args)
            .field("cdp_endpoint", &self.cdp_endpoint)
            .field("remote_debugging_port", &self.remote_debugging_port)
            .field("executable_path", &self.executable_path)
            .field("browser_process", &self.browser_process)
            .finish()
    }
}

/// Launch a browser with the given options.
///
/// By default ([`LaunchMode::Real`]) Browser Commander starts the installed
/// Chrome itself: `--user-data-dir=<fresh temporary profile>
/// --remote-debugging-port=<reserved port>` and nothing else (plus
/// `--headless=new`, restrictions and the caller's arguments when asked for),
/// then attaches the engine over CDP. The browser behaves like one a person
/// started by hand and `navigator.webdriver` stays false. Without an explicit
/// `channel` or `executable_path` the installed Google Chrome is preferred
/// and the engine's own browser is the fallback. Every restriction the
/// library used to add silently is an explicit opt-in through
/// `restrictions`.
///
/// [`LaunchMode::Engine`] keeps the chromiumoxide-, Playwright- or
/// Puppeteer-launched browser for CI and headless use. Playwright and
/// Puppeteer run as a local Node.js subprocess using the official Node
/// package as a CLI bridge; the package must be available to Node module
/// resolution, usually by running `npm install playwright` or `npm install
/// puppeteer` in the configured `node_working_dir`.
///
/// Either way the profile is a fresh temporary one unless `user_data_dir` is
/// set, and [`LaunchResult::close`] closes the browser and deletes it.
///
/// The `Fantoccini` engine is not yet implemented as a managed launcher; use
/// chromiumoxide or connect to an externally-managed WebDriver session.
///
/// # Errors
///
/// Returns an error if the options are invalid or the browser fails to
/// launch. Invalid options are refused before anything is started.
pub async fn launch_browser(options: LaunchOptions) -> Result<LaunchResult, anyhow::Error> {
    if options.engine == EngineType::Fantoccini {
        return Err(anyhow::anyhow!(
            "fantoccini engine launch is not yet implemented; \
             connect to an existing WebDriver session or use EngineType::Chromiumoxide"
        ));
    }
    // Validate before anything is started or written to disk.
    options.all_chrome_args()?;
    refuse_unappliable_fingerprint(options.engine, options.fingerprint.as_ref())?;
    // The node bridge has no CDP route, so a managed download would never be
    // seen and every capture would time out.
    normalize_download_options(options.downloads.clone())
        .map(|_| supported_engine(options.engine))
        .transpose()
        .map_err(|error| anyhow::anyhow!("{error}"))?;

    if options.verbose {
        tracing::info!(
            "Launching browser with {} engine ({})...",
            options.engine,
            options.launch
        );
    }
    let result = match options.launch {
        LaunchMode::Real => launch_real(&options).await?,
        LaunchMode::Engine => launch_with_engine(&options).await?,
    };
    if options.verbose {
        tracing::info!("Browser launched with {} engine", options.engine);
    }
    Ok(result)
}

async fn launch_real(options: &LaunchOptions) -> Result<LaunchResult, anyhow::Error> {
    let real = options.real_browser_options();
    let hooks = Arc::new(DefaultLaunchHooks {
        explicit_selection: options.channel.is_some() || options.executable_path.is_some(),
    });
    let settings = AttachSettings {
        fingerprint: options.fingerprint.as_ref(),
        color_scheme: options.color_scheme.as_ref(),
    };
    let (mut result, launched) = launch_real_browser_with(&real, hooks, |connect| {
        connect_browser_with(connect, settings)
    })
    .await?;

    // Bring the page to front so the address bar is not focused when running
    // headful - mirrors the JS launcher's behavior.
    if !options.headless {
        if let Err(error) = result.page.bring_to_front().await {
            if options.verbose {
                tracing::debug!(%error, "bring_to_front failed");
            }
        }
    }

    result.browser.user_data_dir = launched.user_data_dir;
    result.browser.headless = options.headless;
    result.launch = Some(LaunchMode::Real);
    result.temporary_profile = launched.temporary_profile;
    result.args = launched.args;
    result.cdp_endpoint = Some(launched.cdp_endpoint);
    result.remote_debugging_port = Some(launched.remote_debugging_port);
    result.executable_path = Some(launched.executable_path);
    result.browser_process = Some(launched.browser_process);
    result.closer = Some(launched.closer as Arc<dyn BrowserCloser>);
    Ok(result)
}

impl LaunchResult {
    /// Record an engine launch on an attached result.
    pub(crate) fn launched_by_engine(
        mut self,
        args: Vec<String>,
        temporary_profile: bool,
        executable_path: Option<PathBuf>,
        closer: Arc<dyn BrowserCloser>,
    ) -> Self {
        self.launch = Some(LaunchMode::Engine);
        self.args = args;
        self.temporary_profile = temporary_profile;
        self.executable_path = executable_path;
        self.closer = Some(closer);
        self
    }
}

#[cfg(test)]
#[path = "launcher_tests.rs"]
mod tests;
