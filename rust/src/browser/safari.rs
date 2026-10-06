//! Installed Safari and Technology Preview through classic W3C WebDriver.

use super::{
    browser_process::BrowserCloser,
    find_browser_source,
    launcher::Browser,
    real_browser::{RealBrowserLaunchResult, RealBrowserOptions},
    webdriver::{launch_webdriver, ManagedWebDriver, WebDriverBrowser, WebDriverOptions},
};
use crate::core::engine::{EngineAdapter, EngineError, EngineType};
use anyhow::Result;
use std::{path::PathBuf, sync::Arc};

pub fn is_safari_channel(channel: &str) -> bool {
    find_browser_source(channel).is_some_and(|source| source.family == "safari")
}

pub fn unsupported(feature: &str) -> EngineError {
    EngineError::Unsupported {
        browser: "safari".into(),
        feature: feature.into(),
    }
}

#[derive(Debug, thiserror::Error)]
#[error("Safari automation setup required: {cause}. In Safari → Settings → Advanced enable 'Show features for web developers', then Develop → 'Allow Remote Automation'. Run \"{driver}\" --enable once (an admin password may be required). Call open_safari_settings() to open Advanced settings.")]
pub struct SafariSetupError {
    #[source]
    pub cause: anyhow::Error,
    pub driver: String,
}

pub(crate) fn launch_error(error: anyhow::Error, browser: WebDriverBrowser) -> anyhow::Error {
    let message = error.to_string().to_lowercase();
    if message.contains("allow remote automation")
        || message.contains("--enable")
        || message.contains("not authorized")
        || message.contains("remote automation is disabled")
    {
        SafariSetupError {
            cause: error,
            driver: driver_path(browser).into(),
        }
        .into()
    } else {
        error
    }
}

fn driver_path(browser: WebDriverBrowser) -> &'static str {
    if browser == WebDriverBrowser::SafariTechnologyPreview {
        "/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver"
    } else {
        "/usr/bin/safaridriver"
    }
}

/// Open Advanced settings on explicit request. Authorization stays manual.
pub async fn open_safari_settings(technology_preview: bool) -> Result<()> {
    if !cfg!(target_os = "macos") {
        return Err(unsupported("Safari settings outside macOS").into());
    }
    let app = if technology_preview {
        "Safari Technology Preview"
    } else {
        "Safari"
    };
    crate::utilities::run_command("osascript", &[
        "-e".into(), format!("tell application \"{app}\" to activate"),
        "-e".into(), format!("tell application \"{app}\" to open location \"x-safari-preferences:com.apple.Safari.preferences.Advanced\"")
    ], Default::default()).await?;
    Ok(())
}

#[async_trait::async_trait]
impl BrowserCloser for ManagedWebDriver {
    async fn close(&self) -> Result<()> {
        ManagedWebDriver::close(self).await
    }
}

/// Launch Safari without creating a disk profile. Cookies are opt-in.
pub async fn launch_safari_real(options: RealBrowserOptions) -> Result<RealBrowserLaunchResult> {
    launch_safari_real_with_webdriver(options, WebDriverOptions::default()).await
}

pub(crate) async fn launch_safari_real_with_webdriver(
    options: RealBrowserOptions,
    webdriver_options: WebDriverOptions,
) -> Result<RealBrowserLaunchResult> {
    for (feature, requested) in [
        ("launch restrictions", !options.restrictions.is_empty()),
        (
            "profile migration (use imported seed cookies)",
            options.migrate_from.is_some(),
        ),
        ("CDP port", options.remote_debugging_port.is_some()),
    ] {
        if requested {
            return Err(unsupported(feature).into());
        }
    }
    let source = find_browser_source(&options.channel)
        .ok_or_else(|| anyhow::anyhow!("Unknown Safari channel"))?;
    let browser = if source.id == "safari-technology-preview" {
        WebDriverBrowser::SafariTechnologyPreview
    } else {
        WebDriverBrowser::Safari
    };
    let executable = options
        .executable_path
        .clone()
        .or_else(|| webdriver_options.driver_executable.clone())
        .unwrap_or_else(|| PathBuf::from(driver_path(browser)));
    let native = Arc::new(
        launch_webdriver(WebDriverOptions {
            browser,
            driver_executable: options
                .executable_path
                .or(webdriver_options.driver_executable.clone()),
            user_data_dir: options.user_data_dir,
            headless: options.headless,
            args: [
                options.args,
                options.extra_args,
                webdriver_options.args.clone(),
            ]
            .concat(),
            preferences: options.preferences,
            local_state: options.local_state,
            default_browser_check: options.default_browser_check,
            first_run: options.first_run,
            env: options.env,
            downloads: options.downloads,
            launch_timeout: options.startup_timeout,
            bidi: false,
            ..webdriver_options
        })
        .await?,
    );
    let seed = async {
        let mut state = options
            .storage_state
            .map(|input| input.load())
            .transpose()?
            .unwrap_or(super::storage_state::StorageState {
                cookies: Vec::new(),
                origins: Vec::new(),
            });
        state.cookies.extend(options.seed_cookies);
        if !state.cookies.is_empty() || !state.origins.is_empty() {
            native.restore_state(state).await?;
        }
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if let Err(error) = seed {
        native.close().await?;
        return Err(error);
    }
    let process = native.process_handle();
    let page: Arc<dyn EngineAdapter> = native.clone();
    Ok(RealBrowserLaunchResult {
        browser: Browser {
            engine: EngineType::Fantoccini,
            user_data_dir: PathBuf::new(),
            headless: false,
        },
        page,
        cdp_endpoint: String::new(),
        remote_debugging_port: 0,
        executable_path: executable,
        user_data_dir: PathBuf::new(),
        temporary_profile: false,
        args: Vec::new(),
        browser_process: process,
        downloads: None,
        migration: None,
        closer: native.clone(),
        webdriver: Some(native),
    })
}
