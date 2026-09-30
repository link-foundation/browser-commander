//! The engine launch ([`LaunchMode::Engine`](super::launcher::LaunchMode)):
//! chromiumoxide, Playwright or Puppeteer starts the browser with its own
//! switches, for CI and headless use (issue #103).
//!
//! Mirrors `launchWithEngine` in `js/src/browser/launcher.js`: a temporary
//! profile unless one is given, the opt-in restrictions and the caller's
//! environment for the browser process only, and a close that deletes the
//! temporary profile.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;
use chromiumoxide::browser::{Browser as CdpBrowser, BrowserConfig};
use futures::StreamExt;

use crate::browser::browser_process::BrowserCloser;
use crate::browser::chromiumoxide_adapter::ChromiumoxidePage;
use crate::browser::launcher::{Browser, LaunchOptions, LaunchResult};
use crate::browser::node_bridge::NodeBridgePage;
use crate::browser::playwright_driver::NativePlaywrightPage;
use crate::browser::profile_directory::{
    configure_user_data_dir, prepare_user_data_dir_with_first_run,
};
use crate::browser::profile_directory::{
    create_temporary_user_data_dir_with_first_run, remove_user_data_dir,
};
use crate::browser::webdriver::{launch_webdriver, ManagedWebDriver, WebDriverBrowser};
use crate::core::engine::{EngineAdapter, EngineType};
use crate::downloads::attach_downloads;
use crate::fingerprint::apply::{apply_fingerprint, ApplyOptions};

/// What an engine launch has to close.
#[derive(Clone)]
enum EngineBrowser {
    Chromiumoxide(Arc<ChromiumoxidePage>),
    NodeBridge(Arc<NodeBridgePage>),
    WebDriver(Arc<ManagedWebDriver>),
    Playwright(Arc<NativePlaywrightPage>),
}

impl EngineBrowser {
    fn page(&self) -> Arc<dyn EngineAdapter> {
        match self {
            Self::Chromiumoxide(page) => page.clone(),
            Self::NodeBridge(page) => page.clone(),
            Self::WebDriver(page) => page.clone(),
            Self::Playwright(page) => page.clone(),
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
            Self::WebDriver(page) => {
                let _ = page.close().await;
            }
            Self::Playwright(page) => {
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

/// Launch the browser through the engine.
pub(crate) async fn launch_with_engine(options: &LaunchOptions) -> Result<LaunchResult> {
    let args = if options.engine == EngineType::Fantoccini
        && options.webdriver.browser == WebDriverBrowser::Firefox
    {
        options
            .args
            .iter()
            .chain(&options.extra_args)
            .cloned()
            .collect()
    } else {
        options.all_chrome_args()?
    };
    let env = options.browser_env()?;
    let temporary_profile = options.user_data_dir.is_none();
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
            configure_user_data_dir(
                &user_data_dir,
                options.default_browser_check,
                &options.preferences,
                &options.local_state,
            )?;
        }
        match options.engine {
            EngineType::Chromiumoxide => {
                launch_chromiumoxide(options, &args, env.as_ref(), &user_data_dir).await
            }
            EngineType::Playwright if !options.playwright_bridge => {
                let page = Arc::new(
                    NativePlaywrightPage::launch(options, &args, env.as_ref(), &user_data_dir)
                        .await?,
                );
                let setup = async {
                    if let Some(profile) = &options.fingerprint {
                        apply_fingerprint(page.as_ref(), profile, ApplyOptions::default()).await?;
                    }
                    if let Some(scheme) = &options.color_scheme {
                        page.set_color_scheme(Some(scheme)).await?;
                    }
                    attach_downloads(options.engine, page.as_ref(), options.downloads.clone())
                        .await
                        .map_err(anyhow::Error::from)
                }
                .await;
                match setup {
                    Ok(downloads) => Ok((EngineBrowser::Playwright(page), downloads)),
                    Err(error) => {
                        let _ = page.close().await;
                        Err(error)
                    }
                }
            }
            EngineType::Playwright | EngineType::Puppeteer => {
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
                if let Some(binary) = &options.executable_path {
                    native.browser_executable = Some(binary.clone());
                }
                if let Some(timeout) = options.launch_timeout {
                    native.launch_timeout = timeout;
                }
                let mut driver_env = native.env.take().unwrap_or_default();
                driver_env.extend(env.clone().unwrap_or_default());
                native.env = (!driver_env.is_empty()).then_some(driver_env);
                native.downloads = options.downloads.clone();
                let browser = Arc::new(launch_webdriver(native).await?);
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
    Ok(LaunchResult::attached(
        Browser {
            engine: options.engine,
            user_data_dir,
            headless: options.headless,
        },
        page,
        downloads,
    )
    .launched_by_engine(
        args,
        temporary_profile,
        options.executable_path.clone(),
        closer,
    ))
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
    let mut builder = builder.user_data_dir(user_data_dir).args(args.to_vec());

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
