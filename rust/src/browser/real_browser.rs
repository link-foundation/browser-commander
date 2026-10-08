//! Launch genuine installed Chrome-family browsers and attach over CDP.
//!
//! The browser is started exactly like a person who wants to attach a
//! debugger would start it (issues #101 and #103):
//!
//! ```text
//! chrome --user-data-dir=<fresh temporary profile> --remote-debugging-port=<reserved port> about:blank
//! ```
//!
//! and nothing else. The port is a fixed one reserved on loopback (port 0 and
//! `--remote-debugging-pipe` make Chrome turn `AutomationControlled` on), its
//! ownership is confirmed from the browser's own `DevTools listening on ...`
//! line before the endpoint is trusted, and a lost race is retried on a new
//! port. Every switch the library used to add on its own is an explicit
//! opt-in through [`RealBrowserOptions::restrictions`].

use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use chromiumoxide::Browser as CdpBrowser;
use futures::StreamExt;
use serde_json::Value;

use crate::browser::browser_process::{BrowserCloser, BrowserProcess};
use crate::browser::cdp_endpoint::{wait_for_cdp_endpoint, CdpEndpointRequest};
use crate::browser::connector::ConnectOptions;
use crate::browser::debugging_port::{
    assert_fixed_debugging_port, reserve_loopback_port, DevToolsOutputWatcher, PortRaceError,
};
use crate::browser::launch_diagnostics::{
    launch_failure, redact_launch_evidence, DiagnosticRedactor,
};
use crate::browser::launcher::Browser;
use crate::browser::migration::{
    migrate_profile, MigrateProfileOptions, MigrationSource, MigrationSummary,
};
use crate::browser::profile_directory::{
    configure_user_data_dir_for_profile, create_temporary_user_data_dir_with_first_run,
    prepare_user_data_dir_with_first_run, remove_user_data_dir,
};
use crate::browser::restrictions::{merge_feature_switches, resolve_restrictions};
use crate::browser::storage_state::StorageStateInput;
use crate::core::engine::{EngineAdapter, EngineType};
use crate::downloads::{DownloadManager, DownloadSetting};
use crate::fingerprint::automation_parity::{
    apply_automation_parity_args, detect_automation_controlled_triggers,
};
use crate::utilities::{start_process, StartProcessOptions};

use crate::browser::system_browser::{assert_cdp_browser, resolve_browser_executable};
pub use crate::browser::system_browser::{
    assert_dedicated_user_data_dir, default_real_browser_user_data_dir,
};

const MANAGED_ARGUMENTS: [&str; 4] = [
    "--remote-debugging-address",
    "--remote-debugging-port",
    "--remote-debugging-pipe",
    "--user-data-dir",
];

/// Ports tried when the launcher reserves the port itself.
pub const DEFAULT_PORT_ATTEMPTS: u32 = 3;

/// How long [`RealBrowserLaunchResult::close`] waits for each shutdown step.
pub const DEFAULT_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);

/// How long a browser that lost a port race gets to exit before the retry.
const RACE_EXIT_WAIT: Duration = Duration::from_secs(5);

const FANTOCCINI_OVER_CDP: &str =
    "fantoccini does not connect over CDP; use chromiumoxide, playwright, or puppeteer";

/// Options for launching an installed browser and attaching over CDP.
#[derive(Debug, Clone)]
pub struct RealBrowserOptions {
    pub diagnostic_redactor: Option<DiagnosticRedactor>,
    /// Browser Commander engine used after the browser starts.
    pub engine: EngineType,
    /// Installed Chrome-family channel to discover.
    pub channel: String,
    /// Explicit installed-browser executable, bypassing channel discovery.
    pub executable_path: Option<PathBuf>,
    /// Dedicated, non-default browser profile. When `None` a fresh temporary
    /// profile is created for the launch and deleted when the browser exits.
    pub user_data_dir: Option<PathBuf>,
    /// Explicit owner-only state file used to restore/save session cookies.
    pub persist_session_cookies: Option<PathBuf>,
    /// Profile whose Preferences are seeded before launch.
    pub profile_directory: String,
    /// Whether to ask to become the OS default browser. Defaults to false.
    pub default_browser_check: Option<bool>,
    /// Allow the browser's first-run flow in a fresh profile.
    pub first_run: bool,
    /// JSON object deep-merged into Default/Preferences before launch.
    pub preferences: Value,
    /// JSON object deep-merged into Local State before launch.
    pub local_state: Value,
    /// Playwright-compatible cookie and localStorage state to restore.
    pub storage_state: Option<StorageStateInput>,
    /// Fixed loopback CDP port. When `None` a free port is reserved (and a
    /// lost port race retried). Zero is refused: it makes Chrome enable
    /// `AutomationControlled`.
    pub remote_debugging_port: Option<u16>,
    /// Ports to try when the port is reserved by the launcher.
    pub port_attempts: u32,
    /// Run the installed browser headlessly (`--headless=new`).
    pub headless: bool,
    /// Opt-in restrictions from the shared catalogue, such as
    /// `no-extensions` or the `legacy-defaults` preset. See
    /// [`restrictions`](super::restrictions).
    pub restrictions: Vec<String>,
    /// Additional browser arguments.
    pub args: Vec<String>,
    /// Additional browser arguments appended after the compatibility `args`.
    pub extra_args: Vec<String>,
    /// Ignored since issue #103: there are no Browser Commander defaults left
    /// to omit. Kept so existing code compiles.
    pub ignore_default_args: Vec<String>,
    /// Ignored since issue #103; see [`ignore_default_args`](Self::ignore_default_args).
    pub ignore_all_default_args: bool,
    /// Extra environment for the browser process only. The caller's process
    /// environment is never modified.
    pub env: Option<HashMap<String, String>>,
    /// Add `--disable-blink-features=AutomationControlled` when the command
    /// line contains a switch that would turn `navigator.webdriver` on (such
    /// as a caller-supplied `--enable-automation`). A plain launch, headful or
    /// headless, has none, so its command line stays exactly as typed.
    pub automation_parity: bool,
    /// Maximum time to wait for Chrome's DevTools endpoint.
    pub startup_timeout: Duration,
    /// Time allowed for browser exit before [`RealBrowserLaunchResult::close`] kills it.
    pub close_timeout: Duration,
    /// Delay Playwright/Puppeteer operations by this many milliseconds.
    pub slow_mo: u64,
    /// Optional connection timeout.
    pub timeout: Option<Duration>,
    /// Optional Puppeteer timeout for individual CDP calls.
    pub protocol_timeout: Option<Duration>,
    /// Cookies to seed immediately after attaching.
    pub seed_cookies: Vec<Value>,
    /// Read-only source profile to copy into the dedicated profile before launch.
    pub migrate_from: Option<MigrationSource>,
    /// Data classes to copy. `None` selects every supported class.
    pub migrate_include: Option<Vec<String>>,
    /// Host/subdomain filters for migrated per-site data.
    pub migrate_domains: Vec<String>,
    /// Explicit Safari/Passwords CSV export to import before launching.
    pub migrate_password_csv: Option<PathBuf>,
    /// Separate explicit consent to import payment cards before launching.
    pub migrate_include_payment_cards: bool,
    /// Enable browser and connector logging; the browser's output is mirrored.
    pub verbose: bool,
    /// Node.js executable for Playwright/Puppeteer bridge engines.
    pub node_executable: Option<PathBuf>,
    /// Directory where Node resolves Playwright/Puppeteer.
    pub node_working_dir: Option<PathBuf>,
    /// Manage the installed browser's downloads.
    ///
    /// The same setting and the same manager as
    /// [`LaunchOptions`](super::launcher::LaunchOptions) and
    /// [`ConnectOptions`], which is what makes a download started by hand in a
    /// visible window land where an automated one does. See
    /// [`downloads`](crate::downloads).
    pub downloads: DownloadSetting,
}

#[path = "real_browser_options.rs"]
mod options;

/// Browser/page handles plus metadata for the spawned installed browser.
pub struct RealBrowserLaunchResult {
    /// Browser metadata matching [`crate::browser::launcher::LaunchResult`].
    pub browser: Browser,
    /// Shared engine adapter matching [`crate::browser::launcher::LaunchResult`].
    pub page: Arc<dyn EngineAdapter>,
    /// Resolved loopback DevTools endpoint.
    pub cdp_endpoint: String,
    /// The fixed port the browser listens on.
    pub remote_debugging_port: u16,
    /// Resolved installed-browser executable.
    pub executable_path: PathBuf,
    /// Profile used by the browser.
    pub user_data_dir: PathBuf,
    /// Whether `user_data_dir` is a temporary profile that is deleted when
    /// the browser exits.
    pub temporary_profile: bool,
    /// The browser's exact command line (without the executable).
    pub args: Vec<String>,
    /// The spawned browser. Dropping the result (and every clone of this
    /// handle) stops it; [`close`](Self::close) shuts it down gracefully.
    pub browser_process: BrowserProcess,
    /// The download manager, when the caller asked for managed downloads.
    ///
    /// A visible installed browser is where a person clicks a link themselves,
    /// so this is the manager that sees those downloads too.
    pub downloads: Option<Arc<DownloadManager>>,
    /// Cookie-free profile migration report when `migrate_from` was set.
    pub migration: Option<MigrationSummary>,
    pub(crate) closer: Arc<dyn BrowserCloser>,
    /// Native Safari session, including the complete typed W3C client.
    pub webdriver: Option<Arc<crate::browser::webdriver::ManagedWebDriver>>,
}

impl RealBrowserLaunchResult {
    /// Close the browser: ask it to shut down over CDP, wait up to
    /// `close_timeout`, kill it if it is still running, then delete a
    /// temporary profile. Calling it again does nothing.
    pub async fn close(&self) -> Result<()> {
        self.closer.close().await
    }
}

impl std::fmt::Debug for RealBrowserLaunchResult {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RealBrowserLaunchResult")
            .field("browser", &self.browser)
            .field("page", &"<dyn EngineAdapter>")
            .field("cdp_endpoint", &self.cdp_endpoint)
            .field("remote_debugging_port", &self.remote_debugging_port)
            .field("executable_path", &self.executable_path)
            .field("user_data_dir", &self.user_data_dir)
            .field("temporary_profile", &self.temporary_profile)
            .field("args", &self.args)
            .field("browser_process", &self.browser_process)
            .field("downloads", &self.downloads)
            .field("migration", &self.migration)
            .finish()
    }
}

/// Resolve a genuine installed Chrome-family browser executable.
pub fn resolve_system_browser_executable(options: &RealBrowserOptions) -> Result<PathBuf> {
    resolve_browser_executable(&options.channel, options.executable_path.as_deref())
}

fn assert_no_managed_arguments(options: &RealBrowserOptions) -> Result<()> {
    for argument in options.args.iter().chain(&options.extra_args) {
        if MANAGED_ARGUMENTS
            .iter()
            .any(|managed| argument == managed || argument.starts_with(&format!("{managed}=")))
        {
            return Err(anyhow!("{argument} is managed by launch_real_browser"));
        }
    }
    Ok(())
}

/// The page a real launch opens, as Puppeteer and Playwright do.
///
/// Without a URL, Chrome opens its New Tab page and Microsoft Edge opens the
/// MSN New Tab page plus `edge://welcome-new-profile/`, whose flow closes the
/// window and exits the browser a few seconds after launch (measured with
/// Edge 153, experiments/issue-103/edge-headful.mjs). A URL is not a switch,
/// so both engines see the same command line a person gets from `chrome
/// about:blank`. A start URL among the caller's arguments replaces it.
pub const START_URL: &str = "about:blank";

pub(crate) fn browser_args(
    options: &RealBrowserOptions,
    user_data_dir: &Path,
    remote_debugging_port: u16,
) -> Result<Vec<String>> {
    let port = assert_fixed_debugging_port(remote_debugging_port)?;
    assert_no_managed_arguments(options)?;
    let mut arguments = vec![
        format!("--user-data-dir={}", user_data_dir.display()),
        format!("--remote-debugging-port={port}"),
    ];
    if options.headless {
        arguments.push("--headless=new".to_string());
    }
    arguments.extend(resolve_restrictions(&options.restrictions)?.args);
    arguments.extend(options.args.iter().cloned());
    arguments.extend(options.extra_args.iter().cloned());
    let arguments = merge_feature_switches(&arguments);
    let mut arguments = if options.automation_parity
        && !detect_automation_controlled_triggers(&arguments).is_empty()
    {
        apply_automation_parity_args(&arguments)
    } else {
        arguments
    };
    if arguments.iter().all(|argument| argument.starts_with('-')) {
        arguments.push(START_URL.to_string());
    }
    Ok(arguments)
}

/// Build the exact command line for an installed browser process.
///
/// `--user-data-dir` and `--remote-debugging-port` come first, then
/// `--headless=new` when headless, then the opt-in restrictions and the
/// caller's arguments; repeated feature-list switches are merged, and
/// [`START_URL`] closes the list unless the caller passed a URL. Both
/// `user_data_dir` and `remote_debugging_port` must be set - a launch picks
/// them itself when they are not.
pub fn build_real_browser_args(options: &RealBrowserOptions) -> Result<Vec<String>> {
    let user_data_dir = options.user_data_dir.as_deref().ok_or_else(|| {
        anyhow!("build_real_browser_args needs user_data_dir; launch_real_browser creates a temporary profile when it is not set")
    })?;
    let port = options.remote_debugging_port.ok_or_else(|| {
        anyhow!("build_real_browser_args needs remote_debugging_port; launch_real_browser reserves a free port when it is not set")
    })?;
    browser_args(options, user_data_dir, port)
}

fn validate_launch_request(options: &RealBrowserOptions) -> Result<()> {
    assert_cdp_browser(&options.channel)?;
    if options.engine == EngineType::Fantoccini {
        return Err(anyhow!(FANTOCCINI_OVER_CDP));
    }
    if let Some(port) = options.remote_debugging_port {
        assert_fixed_debugging_port(port)?;
    }
    browser_args(
        options,
        options
            .user_data_dir
            .as_deref()
            .unwrap_or_else(|| Path::new("validation")),
        options.remote_debugging_port.unwrap_or(1),
    )?;
    if let Some(user_data_dir) = &options.user_data_dir {
        assert_dedicated_user_data_dir(user_data_dir)?;
    }
    Ok(())
}

fn browser_environment(options: &RealBrowserOptions) -> Result<Option<HashMap<String, String>>> {
    let mut env = resolve_restrictions(&options.restrictions)?.env;
    if let Some(extra) = &options.env {
        env.extend(
            extra
                .iter()
                .map(|(key, value)| (key.clone(), value.clone())),
        );
    }
    Ok((!env.is_empty() || options.env.is_some()).then_some(env))
}

/// A spawned browser and, when its stderr is captured, the watcher that sees
/// its `DevTools listening on ...` line.
pub(crate) struct SpawnedBrowser {
    pub(crate) process: BrowserProcess,
    pub(crate) dev_tools_output: Option<DevToolsOutputWatcher>,
}

/// The side effects of a launch, replaceable in tests.
#[async_trait]
pub(crate) trait LaunchHooks: Send + Sync {
    fn resolve_executable(&self, options: &RealBrowserOptions) -> Result<PathBuf> {
        resolve_system_browser_executable(options)
    }

    fn reserve_port(&self) -> Result<u16> {
        reserve_loopback_port()
    }

    async fn spawn_browser(
        &self,
        executable_path: &Path,
        args: &[String],
        env: Option<HashMap<String, String>>,
        verbose: bool,
    ) -> Result<SpawnedBrowser> {
        let file = executable_path.to_str().ok_or_else(|| {
            anyhow!(
                "browser executable path is not valid UTF-8: {}",
                executable_path.display()
            )
        })?;
        let watcher = DevToolsOutputWatcher::new();
        let process = start_process(
            file,
            args,
            StartProcessOptions {
                env,
                forward_output: verbose,
                on_stderr: vec![watcher.listener()],
                ..StartProcessOptions::default()
            },
        )
        .await
        .map_err(|error| anyhow!("failed to start installed browser {file}: {error}"))?;
        Ok(SpawnedBrowser {
            process: BrowserProcess::from_managed(process),
            dev_tools_output: Some(watcher),
        })
    }

    async fn wait_for_endpoint(&self, request: CdpEndpointRequest<'_>) -> Result<String> {
        wait_for_cdp_endpoint(request).await
    }

    /// Ask the browser to shut down (`Browser.close` over CDP).
    async fn request_close(&self, cdp_endpoint: &str, timeout: Duration) -> Result<()> {
        let endpoint = cdp_endpoint.to_owned();
        let close = async move {
            let (mut browser, mut handler) = CdpBrowser::connect(endpoint).await?;
            let handler_task = tokio::spawn(async move { while handler.next().await.is_some() {} });
            let result = browser.close().await;
            handler_task.abort();
            result.map(|_| ()).map_err(anyhow::Error::from)
        };
        tokio::time::timeout(timeout, close)
            .await
            .map_err(|_| anyhow!("Browser.close did not answer within {timeout:?}"))?
    }
}

/// The real side effects.
pub(crate) struct SystemLaunchHooks;

impl LaunchHooks for SystemLaunchHooks {}

pub(crate) struct RealBrowserCloser {
    hooks: Arc<dyn LaunchHooks>,
    process: BrowserProcess,
    cdp_endpoint: String,
    user_data_dir: PathBuf,
    temporary_profile: bool,
    close_timeout: Duration,
    closed: tokio::sync::OnceCell<()>,
}

#[async_trait]
impl BrowserCloser for RealBrowserCloser {
    async fn close(&self) -> Result<()> {
        self.closed
            .get_or_try_init(|| async {
                if self.process.is_running() {
                    // A browser that is gone already, or that does not
                    // answer, is handled by the kill below.
                    let _ = self
                        .hooks
                        .request_close(&self.cdp_endpoint, self.close_timeout)
                        .await;
                }
                if self
                    .process
                    .wait_timeout(self.close_timeout)
                    .await
                    .is_none()
                {
                    self.process.kill();
                    self.process.wait_timeout(self.close_timeout).await;
                }
                if self.temporary_profile {
                    remove_user_data_dir(&self.user_data_dir).await?;
                }
                Ok::<(), anyhow::Error>(())
            })
            .await
            .map(|_| ())
    }
}

/// Everything a launch produced besides the engine connection.
pub(crate) struct LaunchedRealBrowser {
    pub(crate) cdp_endpoint: String,
    pub(crate) remote_debugging_port: u16,
    pub(crate) executable_path: PathBuf,
    pub(crate) user_data_dir: PathBuf,
    pub(crate) temporary_profile: bool,
    pub(crate) args: Vec<String>,
    pub(crate) browser_process: BrowserProcess,
    pub(crate) migration: Option<MigrationSummary>,
    pub(crate) closer: Arc<RealBrowserCloser>,
}

impl std::fmt::Debug for LaunchedRealBrowser {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("LaunchedRealBrowser")
            .field("cdp_endpoint", &self.cdp_endpoint)
            .field("remote_debugging_port", &self.remote_debugging_port)
            .field("executable_path", &self.executable_path)
            .field("user_data_dir", &self.user_data_dir)
            .field("temporary_profile", &self.temporary_profile)
            .field("args", &self.args)
            .field("browser_process", &self.browser_process)
            .field("migration", &self.migration)
            .finish()
    }
}

struct Spawned {
    process: BrowserProcess,
    cdp_endpoint: String,
    port: u16,
    args: Vec<String>,
}

async fn spawn_on_free_port(
    options: &RealBrowserOptions,
    hooks: &dyn LaunchHooks,
    executable_path: &Path,
    user_data_dir: &Path,
    env: Option<HashMap<String, String>>,
) -> Result<Spawned> {
    let attempts = match options.remote_debugging_port {
        Some(_) => 1,
        None => options.port_attempts.max(1),
    };
    let mut attempt = 1;
    loop {
        let port = match options.remote_debugging_port {
            Some(port) => port,
            None => hooks.reserve_port()?,
        };
        let args = browser_args(options, user_data_dir, port)?;
        if options.verbose {
            tracing::info!("starting installed browser");
        }
        let spawned = hooks
            .spawn_browser(executable_path, &args, env.clone(), false)
            .await
            .map_err(|error| launch_failure(error, "spawn", options, None))?;
        let waited = hooks
            .wait_for_endpoint(CdpEndpointRequest {
                remote_debugging_port: port,
                user_data_dir,
                browser_process: &spawned.process,
                dev_tools_output: spawned.dev_tools_output.as_ref(),
                timeout: options.startup_timeout,
            })
            .await;
        match waited {
            Ok(cdp_endpoint) => {
                return Ok(Spawned {
                    process: spawned.process,
                    cdp_endpoint,
                    port,
                    args,
                })
            }
            Err(error) => {
                let retry = error.downcast_ref::<PortRaceError>().is_some() && attempt < attempts;
                let failure = launch_failure(error, "endpoint", options, Some(&spawned.process));
                spawned.process.kill();
                spawned.process.wait_timeout(RACE_EXIT_WAIT).await;
                if !retry {
                    return Err(failure);
                }
                if options.verbose {
                    tracing::info!(
                        "{}; retrying with a new port",
                        redact_launch_evidence(
                            &failure.to_string(),
                            options.diagnostic_redactor.as_ref()
                        )
                    );
                }
                attempt += 1;
            }
        }
    }
}

/// Launch with an optional pre-created profile owned by the browser lifecycle.
pub(crate) async fn launch_real_browser_with_owned<T, C, F>(
    options: &RealBrowserOptions,
    hooks: Arc<dyn LaunchHooks>,
    connect: C,
    owned_profile: bool,
) -> Result<(T, LaunchedRealBrowser)>
where
    C: FnOnce(ConnectOptions) -> F,
    F: Future<Output = Result<T>>,
{
    validate_launch_request(options)?;
    if let Some(state) = &options.storage_state {
        state.load()?;
    }
    let executable_path = hooks
        .resolve_executable(options)
        .map_err(|error| launch_failure(error, "discovery", options, None))?;
    let temporary_profile = options.user_data_dir.is_none() || owned_profile;
    let user_data_dir = match &options.user_data_dir {
        Some(user_data_dir) => {
            prepare_user_data_dir_with_first_run(user_data_dir, options.first_run)?
        }
        None => create_temporary_user_data_dir_with_first_run(None, options.first_run)?,
    };
    let (migration, migrated_cookies) = if let Some(source) = options.migrate_from.clone() {
        let target = user_data_dir.join("Default");
        let mut migrate_options = MigrateProfileOptions::new(source, target);
        migrate_options.target_browser = Some(options.channel.clone());
        if let Some(include) = &options.migrate_include {
            migrate_options.include = include.clone();
        }
        migrate_options.domains = options.migrate_domains.clone();
        migrate_options.password_csv = options.migrate_password_csv.clone();
        migrate_options.include_payment_cards = options.migrate_include_payment_cards;
        let result = tokio::task::spawn_blocking(move || migrate_profile(migrate_options)).await;
        let report = match result {
            Ok(Ok(report)) => report,
            Ok(Err(error)) => {
                if temporary_profile {
                    let _ = remove_user_data_dir(&user_data_dir).await;
                }
                return Err(error);
            }
            Err(error) => {
                if temporary_profile {
                    let _ = remove_user_data_dir(&user_data_dir).await;
                }
                return Err(error.into());
            }
        };
        let (cookies, summary) = report.into_parts();
        let values = cookies
            .into_iter()
            .map(serde_json::to_value)
            .collect::<std::result::Result<Vec<_>, _>>()?;
        (Some(summary), values)
    } else {
        (None, Vec::new())
    };
    if let Err(error) = configure_user_data_dir_for_profile(
        &user_data_dir,
        &options.profile_directory,
        options.default_browser_check,
        &options.preferences,
        &options.local_state,
    ) {
        if temporary_profile {
            let _ = remove_user_data_dir(&user_data_dir).await;
        }
        return Err(error);
    }
    let env = browser_environment(options)?;

    let spawned = match spawn_on_free_port(
        options,
        hooks.as_ref(),
        &executable_path,
        &user_data_dir,
        env,
    )
    .await
    {
        Ok(spawned) => spawned,
        Err(error) => {
            if temporary_profile {
                let _ = remove_user_data_dir(&user_data_dir).await;
            }
            return Err(error);
        }
    };
    let process = spawned.process;
    if temporary_profile {
        // The profile goes away with the browser, also when the user closes
        // the window instead of the caller calling close().
        let exited = process.exited();
        let directory = user_data_dir.clone();
        tokio::spawn(async move {
            exited.await;
            let _ = remove_user_data_dir(&directory).await;
        });
    }

    let connection = match connection_options(options, &spawned.cdp_endpoint) {
        Ok(mut connect_options) => {
            connect_options.seed_cookies.extend(migrated_cookies);
            connect(connect_options).await
        }
        Err(error) => Err(error),
    };
    let connection = match connection {
        Ok(connection) => connection,
        Err(error) => {
            let failure = launch_failure(error, "connect", options, Some(&process));
            process.kill();
            process.wait_timeout(options.close_timeout).await;
            if temporary_profile {
                let _ = remove_user_data_dir(&user_data_dir).await;
            }
            return Err(failure);
        }
    };

    let closer = Arc::new(RealBrowserCloser {
        hooks,
        process: process.clone(),
        cdp_endpoint: spawned.cdp_endpoint.clone(),
        user_data_dir: user_data_dir.clone(),
        temporary_profile,
        close_timeout: options.close_timeout,
        closed: tokio::sync::OnceCell::new(),
    });
    Ok((
        connection,
        LaunchedRealBrowser {
            cdp_endpoint: spawned.cdp_endpoint,
            remote_debugging_port: spawned.port,
            executable_path,
            user_data_dir,
            temporary_profile,
            args: spawned.args,
            browser_process: process,
            migration,
            closer,
        },
    ))
}

/// Launch a genuine installed browser and attach.
///
/// The command line is exactly `--user-data-dir=<profile>
/// --remote-debugging-port=<port> about:blank` (plus `--headless=new`, restrictions and
/// the caller's arguments when asked for), so the browser behaves like one a
/// person started by hand and `navigator.webdriver` stays false. Without
/// `user_data_dir` a fresh temporary profile is used and deleted when the
/// browser exits; known default profiles are refused because Chrome 136 and
/// newer ignore remote-debugging switches for them.
pub async fn launch_real_browser(options: RealBrowserOptions) -> Result<RealBrowserLaunchResult> {
    if crate::browser::safari::is_safari_channel(&options.channel) {
        return crate::browser::safari::launch_safari_real(options).await;
    }
    launch_real_browser_owned(options, false).await
}

/// Descriptive alias for [`launch_real_browser`].
pub async fn launch_and_connect_real_browser(
    options: RealBrowserOptions,
) -> Result<RealBrowserLaunchResult> {
    launch_real_browser(options).await
}

#[path = "real_browser_result.rs"]
mod result;
pub(crate) use result::{connection_options, launch_real_browser_owned, launch_real_browser_with};

#[cfg(test)]
#[path = "real_browser_tests.rs"]
mod tests;
