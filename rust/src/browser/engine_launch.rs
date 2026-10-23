//! The engine launch ([`LaunchMode::Engine`](super::launcher::LaunchMode)):
//! chromiumoxide, Playwright or Puppeteer starts the browser with its own
//! switches, for CI and headless use (issue #103).
//!
//! Mirrors `launchWithEngine` in `js/src/browser/launcher.js`: a temporary
//! profile unless one is given, the opt-in restrictions and the caller's
//! environment for the browser process only, and a close that deletes the
//! temporary profile. When the engine starts Chrome for Testing the launch
//! gets the `chrome-for-testing` restrictions first (issue #179).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use chromiumoxide::browser::{Browser as CdpBrowser, BrowserConfig};
use futures::StreamExt;

use crate::browser::browser_process::BrowserCloser;
use crate::browser::chrome_for_testing::prefer_driven;
use crate::browser::chromiumoxide_adapter::ChromiumoxidePage;
use crate::browser::launch_executable::{
    cached_chrome_for_testing, chrome_for_testing_not_installed, node_bundled_executable,
};
use crate::browser::launcher::{Browser, LaunchOptions, LaunchResult};
use crate::browser::node_bridge::NodeBridgePage;
use crate::browser::persistent_profile::{
    headless_shell_warnings, playwright_session_channel, prepare_session_restore,
    resolve_keep_session_cookies,
};
use crate::browser::playwright_driver_page::{PlaywrightDriverPage, PlaywrightLaunch};
use crate::browser::profile_directory::{
    configure_user_data_dir, prepare_user_data_dir_with_first_run,
};
use crate::browser::profile_directory::{
    create_temporary_user_data_dir_with_first_run, remove_user_data_dir,
};
use crate::browser::webdriver::{launch_webdriver_in_profile, ManagedWebDriver, WebDriverBrowser};
use crate::core::engine::{EngineAdapter, EngineType};
use crate::downloads::attach_downloads;
use crate::fingerprint::apply::{apply_fingerprint, ApplyOptions};
use crate::playwright::{DriverOptions, PlaywrightDriver};

/// What an engine launch has to close.
#[derive(Clone)]
enum EngineBrowser {
    Chromiumoxide(Arc<ChromiumoxidePage>),
    NodeBridge(Arc<NodeBridgePage>),
    PlaywrightDriver(Arc<PlaywrightDriverPage>),
    WebDriver(Arc<ManagedWebDriver>),
}

impl EngineBrowser {
    fn page(&self) -> Arc<dyn EngineAdapter> {
        match self {
            Self::Chromiumoxide(page) => page.clone(),
            Self::NodeBridge(page) => page.clone(),
            Self::PlaywrightDriver(page) => page.clone(),
            Self::WebDriver(page) => page.clone(),
        }
    }

    async fn close(&self) {
        // A browser that is already gone is closed; the profile still goes.
        match self {
            Self::Chromiumoxide(page) => {
                let _ = page.close().await;
            }
            Self::NodeBridge(page) => {
                let _ = page.close().await;
            }
            Self::PlaywrightDriver(page) => {
                let _ = page.close().await;
            }
            Self::WebDriver(page) => {
                let _ = page.close().await;
            }
        }
    }
}

/// Closes an engine-launched browser, then deletes its temporary profile.
struct EngineCloser {
    browser: EngineBrowser,
    user_data_dir: PathBuf,
    temporary_profile: bool,
    closed: tokio::sync::OnceCell<()>,
}

struct ProfileGuard {
    path: PathBuf,
    armed: bool,
}
impl Drop for ProfileGuard {
    fn drop(&mut self) {
        if self.armed {
            let path = self.path.clone();
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    let _ = remove_user_data_dir(&path).await;
                });
            } else {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
}
impl Drop for EngineCloser {
    fn drop(&mut self) {
        if self.closed.get().is_none() {
            let browser = self.browser.clone();
            let path = self.user_data_dir.clone();
            let temporary = self.temporary_profile;
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    browser.close().await;
                    if temporary {
                        let _ = remove_user_data_dir(&path).await;
                    }
                });
            } else if temporary {
                let _ = std::fs::remove_dir_all(path);
            }
        }
    }
}

#[async_trait]
impl BrowserCloser for EngineCloser {
    async fn close(&self) -> Result<()> {
        self.closed
            .get_or_try_init(|| async {
                self.browser.close().await;
                if self.temporary_profile {
                    remove_user_data_dir(&self.user_data_dir).await?;
                }
                Ok::<(), anyhow::Error>(())
            })
            .await
            .map(|_| ())
    }
}

/// The Chrome for Testing the engine starts on its own, or the one a
/// chromiumoxide or fantoccini launch is pointed at; `None` when the browser
/// is unknown. `cached` lists the Chrome for Testing downloads an engine
/// finds, newest first, and `bundled` the one a Node engine downloaded.
///
/// chromiumoxide and chromedriver would otherwise start the installed Google
/// Chrome, so without a channel or executable they are given Chrome for
/// Testing - fantoccini one it has the chromedriver of - and chromiumoxide
/// fails without one (issue #179).
///
/// Mirrors `engineExecutable` in `js/src/browser/launcher.js`.
fn engine_executable(
    options: &LaunchOptions,
    cached: impl FnOnce(EngineType) -> Vec<PathBuf>,
    bundled: impl FnOnce(&LaunchOptions) -> Option<PathBuf>,
) -> Result<Option<PathBuf>> {
    if options.executable_path.is_some() || options.channel.is_some() {
        return Ok(options.executable_path.clone());
    }
    Ok(match options.engine {
        EngineType::Fantoccini => match options.webdriver.browser {
            WebDriverBrowser::Chrome => options
                .webdriver
                .browser_executable
                .clone()
                .or_else(|| prefer_driven(cached(EngineType::Fantoccini))),
            _ => None,
        },
        EngineType::Chromiumoxide => Some(
            cached(EngineType::Chromiumoxide)
                .into_iter()
                .next()
                .ok_or_else(|| chrome_for_testing_not_installed(EngineType::Chromiumoxide))?,
        ),
        EngineType::Playwright | EngineType::Puppeteer => bundled(options),
    })
}

/// The options an engine launch runs with, the browser a fantoccini launch
/// starts and the default restrictions added (issue #179).
fn engine_launch_options(
    options: &LaunchOptions,
    executable: Option<PathBuf>,
) -> (LaunchOptions, Option<PathBuf>, Vec<String>) {
    if options.engine == EngineType::Fantoccini {
        // launch_webdriver adds the defaults of the browser it is given.
        return (options.clone(), executable, Vec::new());
    }
    let (mut effective, default_restrictions) =
        options.with_default_restrictions(executable.as_deref());
    if options.engine == EngineType::Chromiumoxide {
        // chromiumoxide itself would detect the installed Google Chrome.
        effective.executable_path = effective.executable_path.take().or(executable);
    }
    (effective, None, default_restrictions)
}

/// Launch the browser through the engine.
pub(crate) async fn launch_with_engine(options: &LaunchOptions) -> Result<LaunchResult> {
    let executable = engine_executable(options, cached_chrome_for_testing, |options| {
        node_bundled_executable(
            options.engine,
            options.node_executable.as_deref(),
            options.node_working_dir.as_deref(),
        )
    })?;
    let (effective, webdriver_browser, default_restrictions) =
        engine_launch_options(options, executable);
    launch(&effective, webdriver_browser, default_restrictions).await
}

/// Launch through the engine; `webdriver_browser` is the Chrome for Testing
/// a fantoccini launch starts when the caller named no browser.
async fn launch(
    options: &LaunchOptions,
    webdriver_browser: Option<PathBuf>,
    mut default_restrictions: Vec<String>,
) -> Result<LaunchResult> {
    let executable_path = options.executable_path.clone().or(webdriver_browser);
    let temporary_profile = options.user_data_dir.is_none();
    let fantoccini = options.engine == EngineType::Fantoccini;
    // A persistent profile keeps session cookies across restarts (issue #187).
    let requested_keep = if fantoccini {
        options
            .keep_session_cookies
            .or(options.webdriver.keep_session_cookies)
    } else {
        options.keep_session_cookies
    };
    let keep_session_cookies = resolve_keep_session_cookies(requested_keep, temporary_profile);
    let restore_tabs = options.restore_tabs || (fantoccini && options.webdriver.restore_tabs);
    let args = if fantoccini && options.webdriver.browser == WebDriverBrowser::Firefox {
        options
            .args
            .iter()
            .chain(&options.extra_args)
            .cloned()
            .collect()
    } else {
        options.chrome_args_with(keep_session_cookies)?
    };
    let session_options;
    let options = match playwright_session_options(options, keep_session_cookies) {
        Some(changed) => {
            session_options = changed;
            &session_options
        }
        None => options,
    };
    let warnings = if keep_session_cookies == Some(true) && !fantoccini {
        headless_shell_warnings(
            options.headless,
            options.channel.as_deref(),
            options.executable_path.as_deref(),
        )
    } else {
        Vec::new()
    };
    let env = options.browser_env()?;
    let user_data_dir = match &options.user_data_dir {
        Some(user_data_dir) => {
            std::fs::create_dir_all(user_data_dir)?;
            user_data_dir.clone()
        }
        None => create_temporary_user_data_dir_with_first_run(None, options.first_run)?,
    };
    let mut profile_guard = ProfileGuard {
        path: user_data_dir.clone(),
        armed: temporary_profile,
    };

    let launched = async {
        if options.engine != EngineType::Fantoccini
            || options.webdriver.browser == WebDriverBrowser::Chrome
        {
            prepare_user_data_dir_with_first_run(&user_data_dir, options.first_run)?;
            let mut preferences =
                super::restrictions::resolve_restrictions(&options.restrictions)?.preferences;
            super::restrictions::merge_preferences(&mut preferences, &options.preferences);
            configure_user_data_dir(
                &user_data_dir,
                options.default_browser_check,
                &preferences,
                &options.local_state,
            )?;
        }
        if !fantoccini {
            prepare_session_restore(&user_data_dir, keep_session_cookies, restore_tabs, &args)?;
        }
        match options.engine {
            EngineType::Chromiumoxide => {
                launch_chromiumoxide(options, &args, env.as_ref(), &user_data_dir).await
            }
            EngineType::Playwright => {
                launch_playwright(options, &args, env.as_ref(), &user_data_dir).await
            }
            EngineType::Puppeteer => {
                launch_node_bridge(options, &args, env.as_ref(), &user_data_dir).await
            }
            EngineType::Fantoccini => {
                let mut native = options.webdriver.clone();
                native.user_data_dir = Some(user_data_dir.clone());
                native.headless = options.headless;
                native.sandbox = options.sandbox;
                native.automation_parity = options.automation_parity;
                native.default_browser_check = options.default_browser_check;
                native.first_run = options.first_run;
                native.local_state = options.local_state.clone();
                let preferences = native
                    .preferences
                    .as_object_mut()
                    .ok_or_else(|| anyhow::anyhow!("WebDriver preferences must be an object"))?;
                preferences.extend(
                    options
                        .preferences
                        .as_object()
                        .ok_or_else(|| anyhow::anyhow!("preferences must be an object"))?
                        .clone(),
                );
                native.args.extend(args.clone());
                if let Some(binary) = &executable_path {
                    native.browser_executable = Some(binary.clone());
                }
                if options.default_restrictions.is_some() {
                    native.default_restrictions = options.default_restrictions.clone();
                }
                if let Some(timeout) = options.launch_timeout {
                    native.launch_timeout = timeout;
                }
                let mut driver_env = native.env.take().unwrap_or_default();
                driver_env.extend(env.clone().unwrap_or_default());
                native.env = (!driver_env.is_empty()).then_some(driver_env);
                native.downloads = options.downloads.clone();
                native.keep_session_cookies = requested_keep;
                native.restore_tabs = restore_tabs;
                let browser =
                    Arc::new(launch_webdriver_in_profile(native, temporary_profile).await?);
                default_restrictions = browser.default_restrictions().to_vec();
                let downloads = browser.downloads().cloned();
                Ok((EngineBrowser::WebDriver(browser), downloads))
            }
        }
    }
    .await;
    let (browser, downloads) = match launched {
        Ok(launched) => launched,
        Err(error) => {
            if temporary_profile {
                let _ = remove_user_data_dir(&user_data_dir).await;
            }
            return Err(error);
        }
    };

    if let Some(input) = &options.storage_state {
        let state = input.load()?;
        if let Err(error) = browser
            .page()
            .restore_storage_state(serde_json::to_value(state)?)
            .await
        {
            browser.close().await;
            if temporary_profile {
                let _ = remove_user_data_dir(&user_data_dir).await;
            }
            return Err(error.into());
        }
    }

    let page = browser.page();
    let closer = Arc::new(EngineCloser {
        browser,
        user_data_dir: user_data_dir.clone(),
        temporary_profile,
        closed: tokio::sync::OnceCell::new(),
    });
    profile_guard.armed = false;
    let mut result = LaunchResult::attached(
        Browser {
            engine: options.engine,
            user_data_dir,
            headless: options.headless,
        },
        page,
        downloads,
    )
    .launched_by_engine(args, temporary_profile, executable_path, closer);
    result.default_restrictions = default_restrictions;
    result.keep_session_cookies = keep_session_cookies == Some(true);
    result.warnings = warnings;
    Ok(result)
}

/// The options a Playwright launch that keeps session cookies runs with:
/// headless, the full Chromium build instead of chromium-headless-shell.
/// `None` when nothing changes.
fn playwright_session_options(
    options: &LaunchOptions,
    keep_session_cookies: Option<bool>,
) -> Option<LaunchOptions> {
    if options.engine != EngineType::Playwright || keep_session_cookies != Some(true) {
        return None;
    }
    let channel = playwright_session_channel(
        options.headless,
        options.channel.as_deref(),
        options.executable_path.as_deref(),
    );
    (channel != options.channel).then(|| LaunchOptions {
        channel,
        ..options.clone()
    })
}

type Launched = (
    EngineBrowser,
    Option<Arc<crate::downloads::DownloadManager>>,
);

async fn launch_node_bridge(
    options: &LaunchOptions,
    args: &[String],
    env: Option<&HashMap<String, String>>,
    user_data_dir: &Path,
) -> Result<Launched> {
    // Fingerprints and managed downloads were refused up front: the bridge
    // speaks its own command protocol rather than CDP.
    let page = NodeBridgePage::launch(options, args, env, user_data_dir).await?;
    Ok((EngineBrowser::NodeBridge(Arc::new(page)), None))
}

/// Playwright through its official driver, with typed protocol calls; the
/// Node bridge only when no matching driver is installed.
async fn launch_playwright(
    options: &LaunchOptions,
    args: &[String],
    env: Option<&HashMap<String, String>>,
    user_data_dir: &Path,
) -> Result<Launched> {
    let driver = match PlaywrightDriver::launch(DriverOptions {
        node: options.node_executable.clone(),
        working_dir: options.node_working_dir.clone(),
        verbose: options.verbose,
    })
    .await
    {
        Ok(driver) => driver,
        Err(error) => {
            tracing::info!(%error, "Playwright driver unavailable; using the Node bridge");
            return launch_node_bridge(options, args, env, user_data_dir).await;
        }
    };
    let launch = PlaywrightLaunch {
        driver: DriverOptions::default(),
        user_data_dir: user_data_dir.to_path_buf(),
        headless: options.headless,
        slow_mo: options.slow_mo,
        args: args.to_vec(),
        env: env.cloned(),
        ignore_all_default_args: options.ignore_all_default_args,
        ignore_default_args: options.all_ignored_default_args(),
        color_scheme: options
            .color_scheme
            .as_ref()
            .map(|cs| cs.as_str().to_string()),
        sandbox: options.sandbox,
        channel: options.channel.clone(),
        executable_path: options.executable_path.clone(),
        timeout: options.launch_timeout,
    };
    let page = PlaywrightDriverPage::launch_with(driver, launch).await?;
    Ok((EngineBrowser::PlaywrightDriver(Arc::new(page)), None))
}

/// Split `--key=value` into the key and value chromiumoxide's builder takes.
/// The builder writes `--{key}` itself, so a whole switch passed as a key
/// reached Chrome as `----key` and was ignored. A switch given twice, such as
/// `--disable-features`, is merged into one comma-separated value.
fn chromiumoxide_arg(argument: &str) -> (&str, Option<&str>) {
    let switch = argument.strip_prefix("--").unwrap_or(argument);
    match switch.split_once('=') {
        Some((key, value)) => (key, Some(value)),
        None => (switch, None),
    }
}

async fn launch_chromiumoxide(
    options: &LaunchOptions,
    args: &[String],
    env: Option<&HashMap<String, String>>,
    user_data_dir: &Path,
) -> Result<Launched> {
    // chromiumoxide 0.9 stopped re-exporting `HeadlessMode`, so the mode is
    // selected through the builder's own methods instead of the enum.
    let builder = BrowserConfig::builder();
    let builder = if options.headless {
        builder.new_headless_mode()
    } else {
        builder.with_head()
    };
    let mut builder = builder.user_data_dir(user_data_dir);
    for argument in args {
        builder = match chromiumoxide_arg(argument) {
            (key, Some(value)) => builder.arg((key, value)),
            (key, None) => builder.arg(key),
        };
    }

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
    // Added to the browser's environment only; chromiumoxide keeps the
    // parent's environment underneath and this process's is never modified.
    if let Some(env) = env {
        builder = builder.envs(env.clone());
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

    let page = match browser.new_page("about:blank").await {
        Ok(page) => page,
        Err(error) => {
            let mut browser = browser;
            let _ = browser.close().await;
            let _ = browser.wait().await;
            handler_task.abort();
            return Err(anyhow::anyhow!("failed to open initial page: {error}"));
        }
    };
    let adapter = Arc::new(ChromiumoxidePage::new(
        page,
        browser,
        handler_task,
        user_data_dir.to_path_buf(),
    ));
    match set_up_page(options, &adapter).await {
        Ok(downloads) => Ok((EngineBrowser::Chromiumoxide(adapter), downloads)),
        Err(error) => {
            let _ = adapter.close().await;
            Err(error)
        }
    }
}

/// Apply the fingerprint, downloads and color scheme before the caller can
/// navigate.
async fn set_up_page(
    options: &LaunchOptions,
    adapter: &ChromiumoxidePage,
) -> Result<Option<Arc<crate::downloads::DownloadManager>>> {
    // A failure here is fatal rather than best-effort: a half-applied profile
    // describes a machine that does not exist, which is louder than none.
    if let Some(ref profile) = options.fingerprint {
        apply_fingerprint(adapter, profile, ApplyOptions::default()).await?;
        if options.verbose {
            tracing::info!("Fingerprint profile applied");
        }
    }

    // A download that starts on the first page must land in the managed
    // directory like every later one.
    let downloads = attach_downloads(options.engine, adapter, options.downloads.clone())
        .await
        .map_err(|error| anyhow::anyhow!("{error}"))?;

    if let Some(ref color_scheme) = options.color_scheme {
        if let Err(error) = adapter.set_color_scheme(Some(color_scheme)).await {
            if options.verbose {
                tracing::warn!(%error, "could not set color scheme");
            }
        }
    }

    // Bring the page to front so the address bar is not focused when running
    // headful - mirrors the JS launcher's behavior.
    if !options.headless {
        if let Err(error) = adapter.bring_to_front().await {
            if options.verbose {
                tracing::debug!(%error, "bring_to_front failed");
            }
        }
    }
    Ok(downloads)
}

#[cfg(test)]
#[path = "engine_launch_tests.rs"]
mod tests;
