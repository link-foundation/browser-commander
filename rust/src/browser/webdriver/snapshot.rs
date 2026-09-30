//! Native WebDriver owns a copied live Chromium profile, never its source.
use super::{launch_owned, ManagedWebDriver, WebDriverBrowser, WebDriverOptions};
use crate::browser::snapshot::{copy_owned_snapshot, SnapshotOptions, SnapshotReport};
use std::ops::Deref;

pub struct WebDriverSnapshotResult {
    pub browser: ManagedWebDriver,
    pub snapshot: SnapshotReport,
}
impl Deref for WebDriverSnapshotResult {
    type Target = ManagedWebDriver;
    fn deref(&self) -> &Self::Target {
        &self.browser
    }
}

/// Copy a live Chromium profile and launch it through native Fantoccini.
/// Firefox uses a different profile format and cannot consume Chromium copies.
pub async fn launch_webdriver_snapshot(
    source: SnapshotOptions,
    mut options: WebDriverOptions,
) -> anyhow::Result<WebDriverSnapshotResult> {
    if options.browser != WebDriverBrowser::Chrome {
        anyhow::bail!("Chromium snapshots require WebDriverBrowser::Chrome");
    }
    if options.user_data_dir.is_some()
        || options
            .args
            .iter()
            .any(|arg| arg.trim_start_matches('-').starts_with("profile-directory"))
    {
        anyhow::bail!(
            "snapshot owns user_data_dir and profile-directory; use SnapshotOptions.profile"
        );
    }
    let profile = source.profile.clone();
    let mut copy = copy_owned_snapshot(source).await?;
    options.user_data_dir = Some(copy.report.target.clone());
    options.args.push(format!("--profile-directory={profile}"));
    let browser = launch_owned(options, true).await?;
    copy.armed = false;
    Ok(WebDriverSnapshotResult {
        browser,
        snapshot: copy.report.clone(),
    })
}
