//! Assemble the shared connection and installed-browser launch metadata.

use super::{LaunchedRealBrowser, RealBrowserLaunchResult};
use crate::browser::launcher::LaunchResult;

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
