//! What a managed download is, and what can be asked of one (issue #88).
//!
//! These are the types callers name: the lifecycle states, the record of one
//! download, and the two option builders. They are kept apart from
//! [`crate::downloads::manager`] because the vocabulary is what a caller reads,
//! while the manager is what the browser drives.
//!
//! # Example
//!
//! ```rust
//! use std::time::Duration;
//!
//! use browser_commander::downloads::{CaptureOptions, DownloadOptions};
//!
//! let browser_wide = DownloadOptions::default().directory("/tmp/reports");
//! let one_download = CaptureOptions::named("q3.pdf").within(Duration::from_secs(20));
//! assert_eq!(browser_wide.directory.as_deref(), Some("/tmp/reports"));
//! assert_eq!(one_download.timeout, Some(Duration::from_secs(20)));
//! ```

use std::fmt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::downloads::store::{DownloadConflict, DownloadNamer, DownloadValidator};

/// Lifecycle states every download passes through.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadEvent {
    /// The engine announced a download.
    Started,
    /// The bytes are on disk under their final name.
    Completed,
    /// The download ended in an error.
    Failed,
    /// The browser or the person stopped it.
    Cancelled,
}

impl DownloadEvent {
    /// The name this state is known by in every language the library ships in.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Started => "started",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

impl fmt::Display for DownloadEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Everything known about one download.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadArtifact {
    /// Identifier this download is reported under.
    pub id: String,
    /// Source URL, when the engine reports one.
    pub url: Option<String>,
    /// Name the page suggested.
    pub suggested_filename: Option<String>,
    /// Where the download is in its lifecycle.
    pub state: DownloadEvent,
    /// When the engine announced it, as an ISO-8601 UTC timestamp.
    pub started_at: String,
    /// When it settled, as an ISO-8601 UTC timestamp.
    pub completed_at: Option<String>,
    /// Final path, once the bytes have been placed.
    pub path: Option<PathBuf>,
    /// MIME type declared by the server, when there is one.
    pub mime_type: Option<String>,
    /// Size in bytes, once the bytes have been placed.
    pub bytes: Option<u64>,
    /// Hex-encoded SHA-256 of the saved bytes.
    pub checksum: Option<String>,
    /// Whatever the engine or the store reported, kept verbatim.
    pub failure: Option<String>,
}

/// Naming, validation and conflict rules one
/// [`DownloadManager::capture`](crate::downloads::DownloadManager::capture) owns.
#[derive(Clone, Default)]
pub struct CaptureOptions {
    /// Name for this download, overriding what the page suggested.
    pub filename: Option<DownloadNamer>,
    /// Budget for the whole capture.
    pub timeout: Option<Duration>,
    /// Validation for this download.
    pub validate: Option<DownloadValidator>,
    /// Conflict policy for this download.
    pub conflict: Option<DownloadConflict>,
}

impl CaptureOptions {
    /// Capture the next download under a fixed name.
    ///
    /// # Arguments
    ///
    /// * `name` - Name to save the download as
    ///
    /// # Returns
    ///
    /// Options naming the download the caller is about to trigger.
    pub fn named(name: impl Into<String>) -> Self {
        let name = name.into();
        Self {
            filename: Some(Arc::new(move |_naming| name.clone())),
            ..Self::default()
        }
    }

    /// Give the whole capture a different budget.
    pub fn within(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Check this download before it is published.
    pub fn validated_by(mut self, validate: DownloadValidator) -> Self {
        self.validate = Some(validate);
        self
    }

    /// Resolve a name collision differently for this download.
    pub fn on_conflict(mut self, conflict: DownloadConflict) -> Self {
        self.conflict = Some(conflict);
        self
    }
}

impl fmt::Debug for CaptureOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CaptureOptions")
            .field("filename", &self.filename.is_some())
            .field("timeout", &self.timeout)
            .field("validate", &self.validate.is_some())
            .field("conflict", &self.conflict)
            .finish()
    }
}

/// How a browser's downloads are managed.
#[derive(Clone)]
pub struct DownloadOptions {
    /// Absolute path, [`DownloadDirectoryPreset::USER_DOWNLOADS`] or
    /// [`DownloadDirectoryPreset::TEMPORARY`].
    ///
    /// [`DownloadDirectoryPreset::USER_DOWNLOADS`]: crate::downloads::DownloadDirectoryPreset::USER_DOWNLOADS
    /// [`DownloadDirectoryPreset::TEMPORARY`]: crate::downloads::DownloadDirectoryPreset::TEMPORARY
    pub directory: Option<String>,
    /// Keep files after the browser closes. Always true today, and named so
    /// that a future non-persistent mode cannot change this one silently.
    pub persist: bool,
    /// How a name that is already taken is resolved.
    pub conflict: DownloadConflict,
    /// Naming callback for every download.
    pub filename: Option<DownloadNamer>,
    /// Validation for every download.
    pub validate: Option<DownloadValidator>,
    /// How often the staging directory is listed.
    pub poll_interval: Option<Duration>,
}

impl Default for DownloadOptions {
    fn default() -> Self {
        Self {
            directory: None,
            persist: true,
            conflict: DownloadConflict::default(),
            filename: None,
            validate: None,
            poll_interval: None,
        }
    }
}

impl DownloadOptions {
    /// Save downloads into a specific directory or preset.
    pub fn directory(mut self, directory: impl Into<String>) -> Self {
        self.directory = Some(directory.into());
        self
    }

    /// Resolve name collisions with this policy.
    pub fn conflict(mut self, conflict: DownloadConflict) -> Self {
        self.conflict = conflict;
        self
    }

    /// Name every download with this callback.
    pub fn filename(mut self, filename: DownloadNamer) -> Self {
        self.filename = Some(filename);
        self
    }

    /// Check every download before it is published.
    pub fn validate(mut self, validate: DownloadValidator) -> Self {
        self.validate = Some(validate);
        self
    }

    /// List the staging directory this often.
    pub fn poll_interval(mut self, interval: Duration) -> Self {
        self.poll_interval = Some(interval);
        self
    }
}

impl fmt::Debug for DownloadOptions {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DownloadOptions")
            .field("directory", &self.directory)
            .field("persist", &self.persist)
            .field("conflict", &self.conflict)
            .field("filename", &self.filename.is_some())
            .field("validate", &self.validate.is_some())
            .field("poll_interval", &self.poll_interval)
            .finish()
    }
}
