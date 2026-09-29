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
use crate::browser::profile_directory::{create_temporary_user_data_dir, remove_user_data_dir};
use crate::core::engine::{EngineAdapter, EngineType};
use crate::downloads::attach_downloads;
use crate::fingerprint::apply::{apply_fingerprint, ApplyOptions};

/// What an engine launch has to close.
enum EngineBrowser {
    Chromiumoxide(Arc<ChromiumoxidePage>),
    NodeBridge(Arc<NodeBridgePage>),
}

impl EngineBrowser {
    fn page(&self) -> Arc<dyn EngineAdapter> {
        match self {
            Self::Chromiumoxide(page) => page.clone(),
            Self::NodeBridge(page) => page.clone(),
        }
    }

    async fn close(&self) {
        // A browser that is already gone is closed; the profile still goes.
        let _ = match self {
            Self::Chromiumoxide(page) => page.close().await,
            Self::NodeBridge(page) => page.close().await,
        };
    }
}

/// Closes an engine-launched browser, then deletes its temporary profile.
struct EngineCloser {
    browser: EngineBrowser,
    user_data_dir: PathBuf,
    temporary_profile: bool,
    closed: tokio::sync::OnceCell<()>,
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
    let args = options.all_chrome_args()?;
    let env = options.browser_env()?;
    let temporary_profile = options.user_data_dir.is_none();
    let user_data_dir = match &options.user_data_dir {
        Some(user_data_dir) => {
            std::fs::create_dir_all(user_data_dir)?;
            user_data_dir.clone()
        }
        None => create_temporary_user_data_dir(None)?,
    };

    let launched = match options.engine {
        EngineType::Chromiumoxide => {
            launch_chromiumoxide(options, &args, env.as_ref(), &user_data_dir).await
        }
        EngineType::Playwright | EngineType::Puppeteer => {
            launch_node_bridge(options, &args, env.as_ref(), &user_data_dir).await
        }
        EngineType::Fantoccini => Err(anyhow::anyhow!(
            "fantoccini engine launch is not yet implemented"
        )),
    };
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
