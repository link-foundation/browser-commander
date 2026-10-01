//! Assemble the shared connection and installed-browser launch metadata.

use std::future::Future;
use std::sync::Arc;

use super::{
    launch_real_browser_with_owned, LaunchHooks, LaunchedRealBrowser, RealBrowserLaunchResult,
    RealBrowserOptions, FANTOCCINI_OVER_CDP,
};
use crate::browser::connector::ConnectOptions;
use crate::browser::launcher::LaunchResult;
use crate::core::engine::EngineType;
use anyhow::{anyhow, Result};

/// Start the browser and attach with `connect`, returning the connection and
/// the launch. Generic over the connection so the launcher can apply a
/// fingerprint while attaching and tests can attach to nothing.
pub(crate) async fn launch_real_browser_with<T, C, F>(
    options: &RealBrowserOptions,
    hooks: Arc<dyn LaunchHooks>,
    connect: C,
) -> Result<(T, LaunchedRealBrowser)>
where
    C: FnOnce(ConnectOptions) -> F,
    F: Future<Output = Result<T>>,
{
    launch_real_browser_with_owned(options, hooks, connect, false).await
}

pub(crate) fn connection_options(
    options: &RealBrowserOptions,
    endpoint: &str,
) -> Result<ConnectOptions> {
    let mut connection = match options.engine {
        EngineType::Chromiumoxide => ConnectOptions::chromiumoxide(),
        EngineType::Playwright => ConnectOptions::playwright(),
        EngineType::Puppeteer => ConnectOptions::puppeteer(),
        EngineType::Fantoccini => return Err(anyhow!(FANTOCCINI_OVER_CDP)),
    };
    connection.cdp_endpoint = Some(endpoint.to_string());
    connection.slow_mo = options.slow_mo;
    connection.timeout = options.timeout;
    connection.protocol_timeout = options.protocol_timeout;
    connection.seed_cookies = options.seed_cookies.clone();
    connection.storage_state = options.storage_state.clone();
    connection.verbose = options.verbose;
    connection.node_executable = options.node_executable.clone();
    connection.node_working_dir = options.node_working_dir.clone();
    connection.downloads = options.downloads.clone();
    Ok(connection)
}

pub(super) fn real_browser_result(
    connection: LaunchResult,
    launched: LaunchedRealBrowser,
    headless: bool,
) -> RealBrowserLaunchResult {
    let LaunchResult {
        mut browser,
        page,
        downloads,
        ..
    } = connection;
    browser.user_data_dir = launched.user_data_dir.clone();
    browser.headless = headless;
    RealBrowserLaunchResult {
        browser,
        page,
        cdp_endpoint: launched.cdp_endpoint,
        remote_debugging_port: launched.remote_debugging_port,
        executable_path: launched.executable_path,
        user_data_dir: launched.user_data_dir,
        temporary_profile: launched.temporary_profile,
        args: launched.args,
        browser_process: launched.browser_process,
        downloads,
        migration: launched.migration,
        closer: launched.closer,
    }
}
