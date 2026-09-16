//! Engine-specific download event sources (issue #88).
//!
//! Each source turns one engine's download notifications into the same three
//! calls — `started`, `finished`, `failed` — so the manager above them does not
//! know or care where the bytes came from, and a download a human started by
//! hand is reported exactly like an automated one.
//!
//! Rust drives Chromium over CDP through [`CdpTransport`], which is
//! request/response only: it can tell Chromium where to put downloads, but it
//! has no event stream to hear about them on. Watching the staging directory is
//! what gives Rust the same managed lifecycle anyway — see
//! [`crate::downloads::watcher`], and `docs/feature-parity.md` for how this
//! compares with the JavaScript and Python sources.
//!
//! # Example
//!
//! ```rust
//! use browser_commander::downloads::{classify_failure, DownloadFailure};
//!
//! // The engine's own words are what tells a stopped download from a broken one.
//! assert_eq!(classify_failure("canceled by the user"), DownloadFailure::Cancelled);
//! assert_eq!(classify_failure("net::ERR_FAILED"), DownloadFailure::Failed);
//! ```

use std::fmt;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;

use async_trait::async_trait;
use serde_json::json;

use crate::downloads::store::DownloadSource;
use crate::downloads::DownloadError;
use crate::fingerprint::apply::CdpTransport;

/// Directory the engine writes into before we place the file.
pub const STAGING_DIRECTORY: &str = ".browser-commander-staging";

/// Why a download ended without a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadFailure {
    /// The browser or the person stopped it.
    Cancelled,
    /// It ended in an error.
    Failed,
}

impl DownloadFailure {
    /// The name this outcome is known by in every language the library ships in.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }
}

impl fmt::Display for DownloadFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Classify an engine's failure text.
///
/// "A download UI entry is not completion evidence" (issue #88): the engine's
/// own words are the only thing that distinguishes a user cancelling a download
/// from a network error, so they are preserved and classified, not flattened.
///
/// # Arguments
///
/// * `reason` - Engine-reported reason
///
/// # Returns
///
/// Which kind of ending this was.
pub fn classify_failure(reason: &str) -> DownloadFailure {
    if reason.to_ascii_lowercase().contains("cancel") {
        DownloadFailure::Cancelled
    } else {
        DownloadFailure::Failed
    }
}

/// What an engine reports when a download begins.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DownloadStart {
    /// The engine's own identity for this download, used to deduplicate.
    pub engine_handle: String,
    /// Source URL.
    pub url: Option<String>,
    /// Name the page suggested.
    pub suggested_filename: Option<String>,
    /// MIME type declared by the server, when the engine reports one.
    pub mime_type: Option<String>,
}

/// What a source tells the manager about the downloads it sees.
///
/// Implemented by [`crate::downloads::DownloadManager`]; a source is written
/// against this trait so a test can watch a directory without a browser.
#[async_trait]
pub trait DownloadSink: Send + Sync {
    /// Record a download the engine has just announced.
    ///
    /// # Arguments
    ///
    /// * `start` - What the engine reported
    ///
    /// # Returns
    ///
    /// The identifier the download is reported under.
    fn started(&self, start: DownloadStart) -> String;

    /// Place a finished download's bytes under their final name.
    ///
    /// # Arguments
    ///
    /// * `id` - Identifier returned by [`DownloadSink::started`]
    /// * `source` - Where the engine left the bytes
    async fn finished(&self, id: String, source: DownloadSource);

    /// Record a download that ended without a file.
    ///
    /// # Arguments
    ///
    /// * `id` - Identifier returned by [`DownloadSink::started`]
    /// * `kind` - Which kind of ending this was
    /// * `reason` - Engine-reported reason, kept verbatim
    fn failed(&self, id: String, kind: DownloadFailure, reason: String);
}

/// A source that has been attached to a browser.
pub struct SourceHandle {
    /// Where the engine is writing downloads before we place them.
    pub staging_directory: PathBuf,
    /// Stop observing, without touching any file already saved.
    pub detach: Box<dyn FnOnce() -> Pin<Box<dyn Future<Output = ()> + Send>> + Send>,
}

impl fmt::Debug for SourceHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SourceHandle")
            .field("staging_directory", &self.staging_directory)
            .finish_non_exhaustive()
    }
}

/// Create the staging directory the browser downloads into.
///
/// # Arguments
///
/// * `root` - Managed download directory
///
/// # Returns
///
/// The staging directory, which exists once this returns.
///
/// # Errors
///
/// Returns [`DownloadError::DirectoryNotCreated`] when it cannot be created.
pub fn prepare_staging_directory(root: &Path) -> Result<PathBuf, DownloadError> {
    let staging_directory = root.join(STAGING_DIRECTORY);
    std::fs::create_dir_all(&staging_directory).map_err(|source| {
        DownloadError::DirectoryNotCreated {
            root: staging_directory.clone(),
            source,
        }
    })?;
    let _ = crate::downloads::destination::restrict(
        &staging_directory,
        crate::downloads::destination::ARTIFACT_DIRECTORY_MODE,
    );
    Ok(staging_directory)
}

/// Point Chromium at the staging directory.
///
/// This is what makes a download a *person* started observable, because
/// `Browser.setDownloadBehavior` is browser-wide rather than per-automation.
///
/// The behavior is `allow` rather than `allowAndName`: without a
/// `Browser.downloadProgress` event stream, a GUID-named file could not be
/// matched back to the name the page suggested, and the person who clicked the
/// link would get a file called `7f1c…` instead of `report.pdf`.
///
/// # Arguments
///
/// * `transport` - A CDP connection with Browser-domain access
/// * `staging_directory` - Where Chromium should write downloads
///
/// # Errors
///
/// Returns the transport's error when the browser refuses the command, which is
/// how an attached browser that denies the Browser domain reports itself.
pub async fn set_download_behavior(
    transport: &dyn CdpTransport,
    staging_directory: &Path,
) -> anyhow::Result<()> {
    transport
        .send(
            "Browser.setDownloadBehavior",
            json!({
                "behavior": "allow",
                "downloadPath": staging_directory.to_string_lossy(),
                "eventsEnabled": true,
            }),
        )
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::downloads::test_support::{RecordingTransport, TempDir};

    #[test]
    fn reads_a_cancellation_out_of_the_engines_own_words() {
        assert_eq!(
            classify_failure("Download canceled by the user"),
            DownloadFailure::Cancelled
        );
        assert_eq!(
            classify_failure("download cancelled"),
            DownloadFailure::Cancelled
        );
        assert_eq!(classify_failure("net::ERR_FAILED"), DownloadFailure::Failed);
        assert_eq!(classify_failure(""), DownloadFailure::Failed);
    }

    #[test]
    fn names_the_two_outcomes_the_way_the_other_languages_do() {
        assert_eq!(DownloadFailure::Cancelled.to_string(), "cancelled");
        assert_eq!(DownloadFailure::Failed.to_string(), "failed");
    }

    #[test]
    fn creates_the_staging_directory_inside_the_managed_root() {
        let temp = TempDir::new("bc-staging");
        let root = temp.path().join("downloads");

        let staging = prepare_staging_directory(&root).unwrap();

        assert_eq!(staging, root.join(STAGING_DIRECTORY));
        assert!(staging.is_dir());
    }

    #[tokio::test]
    async fn tells_the_browser_where_to_put_downloads() {
        let temp = TempDir::new("bc-behavior");
        let transport = RecordingTransport::default();

        set_download_behavior(&transport, temp.path())
            .await
            .unwrap();

        let sent = transport.sent();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].0, "Browser.setDownloadBehavior");
        assert_eq!(sent[0].1["behavior"], "allow");
        assert_eq!(
            sent[0].1["downloadPath"],
            temp.path().to_string_lossy().as_ref()
        );
    }

    #[tokio::test]
    async fn reports_a_browser_that_refuses_the_browser_domain() {
        let temp = TempDir::new("bc-behavior-refused");
        let transport = RecordingTransport::refusing("Browser domain is not available");

        let error = set_download_behavior(&transport, temp.path())
            .await
            .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("Browser domain is not available"),
            "unexpected message: {error}"
        );
    }
}
