//! Managed, persistent downloads (issue #88).
//!
//! The manager owns one lifecycle for every download the browser performs -
//! automated or started by a person - and guarantees three things a caller
//! cannot get from an engine event alone:
//!
//! - the file survives the page, context and browser that produced it;
//! - a download is saved once and reported once, even when a global listener
//!   and an awaited [`DownloadManager::capture`] both see it;
//! - a file under its final name is complete and has passed validation.
//!
//! # The Rust source, and why it is the filesystem
//!
//! JavaScript listens to `Browser.downloadWillBegin` and
//! `Browser.downloadProgress`, which is how it observes a download a *person*
//! started. This crate's [`CdpTransport`](crate::fingerprint::CdpTransport) is
//! request/response only - there is no event stream - so Rust points the
//! browser at a staging directory with `Browser.setDownloadBehavior` and
//! watches that directory instead. Python does the same for Selenium. The
//! guarantees above are unchanged; what is lost is the engine's own progress
//! reporting, and `docs/feature-parity.md` says so rather than leaving it to
//! be discovered.
//!
//! # Example
//!
//! ```rust,no_run
//! use browser_commander::downloads::{DownloadManager, DownloadOptions};
//!
//! # async fn example(page: &browser_commander::browser::ChromiumoxidePage)
//! # -> anyhow::Result<()> {
//! let manager = DownloadManager::create(DownloadOptions::default())?;
//! manager.attach(page).await?;
//! let artifact = manager
//!     .capture(Default::default(), async { Ok(()) })
//!     .await?;
//! println!("saved {}", artifact.path.expect("a completed download has a path").display());
//! # Ok(())
//! # }
//! ```

pub mod attach;
pub mod destination;
pub mod manager;
pub mod naming;
pub mod options;
pub mod sources;
pub mod store;
pub mod watcher;

use std::path::PathBuf;

pub use attach::{attach_downloads, normalize_download_options, supported_engine, DownloadSetting};
pub use destination::{
    prepare_download_directory, resolve_download_directory, DownloadDirectoryPreset,
    ARTIFACT_DIRECTORY_MODE, ARTIFACT_FILE_MODE,
};
pub use manager::{DownloadManager, DEFAULT_CAPTURE_TIMEOUT};
pub use naming::{
    extension_from_content, is_inside_root, renamed_candidate, resolve_inside_root,
    sanitize_download_name, with_extension,
};
pub use options::{CaptureOptions, DownloadArtifact, DownloadEvent, DownloadOptions};
pub use sources::{
    classify_failure, prepare_staging_directory, set_download_behavior, DownloadFailure,
    DownloadSink, DownloadStart, SourceHandle, STAGING_DIRECTORY,
};
pub use store::{
    clean_partials, resolve_final_path, save_download, DownloadCandidate, DownloadConflict,
    DownloadNamer, DownloadNaming, DownloadSource, DownloadValidator, SaveRequest, SavedDownload,
};
pub use watcher::{
    attach_filesystem_watcher, DirectoryWatcher, StagedDownload, DEFAULT_POLL_INTERVAL,
    IN_PROGRESS_SUFFIXES,
};

/// Everything that can stop a download from reaching the caller's directory.
///
/// Every variant names the file or directory it is about: a download that
/// failed is reported by its own name, not by a generic I/O message that
/// leaves the caller guessing which of several downloads is missing.
#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    /// A name would have placed the file outside the managed directory.
    #[error("refusing to write \"{name}\" outside the download directory {}", root.display())]
    OutsideRoot {
        /// The name that was refused.
        name: String,
        /// The managed download directory.
        root: PathBuf,
    },

    /// `downloads.directory` was empty or relative.
    #[error("downloads.directory must be absolute, received \"{directory}\"")]
    RelativeDirectory {
        /// What the caller passed.
        directory: String,
    },

    /// The download directory could not be created.
    #[error("download directory {} could not be created: {source}", root.display())]
    DirectoryNotCreated {
        /// The directory that was asked for.
        root: PathBuf,
        /// The underlying failure.
        #[source]
        source: std::io::Error,
    },

    /// The download directory exists but cannot be written to.
    #[error("download directory {} is not writable: {source}", root.display())]
    DirectoryNotWritable {
        /// The directory that was probed.
        root: PathBuf,
        /// The underlying failure.
        #[source]
        source: std::io::Error,
    },

    /// The name is taken and the conflict policy forbids replacing it.
    #[error("refusing to replace {}: downloads.conflict is 'error'", path.display())]
    NameTaken {
        /// The file that would have been replaced.
        path: PathBuf,
    },

    /// Every renamed candidate was taken too.
    #[error("could not find a free name for \"{name}\" after {attempts} attempts")]
    NoFreeName {
        /// The name that was being placed.
        name: String,
        /// How many candidates were tried.
        attempts: usize,
    },

    /// The caller's validation returned `false`.
    #[error("\"{name}\" was rejected by the caller's validation")]
    Rejected {
        /// The download that was rejected.
        name: String,
    },

    /// The caller's validation itself failed.
    #[error("\"{name}\" could not be validated: {reason}")]
    ValidationFailed {
        /// The download that was being validated.
        name: String,
        /// The validator's own message, kept verbatim.
        reason: String,
    },

    /// Reading or writing a file failed.
    #[error("{}: {source}", path.display())]
    Io {
        /// The file involved.
        path: PathBuf,
        /// The underlying failure.
        #[source]
        source: std::io::Error,
    },

    /// No download settled inside the capture's budget.
    #[error("no download completed within {timeout_ms}ms of the triggering action")]
    CaptureTimeout {
        /// The budget that expired, in milliseconds.
        timeout_ms: u64,
    },

    /// A download settled without a file.
    ///
    /// A failed or cancelled download is never reported as a success, which is
    /// the whole point of settling a capture on the artifact's state rather
    /// than on the mere arrival of an event.
    #[error("download {id} {state}: {failure}")]
    DownloadFailed {
        /// Identifier of the download.
        id: String,
        /// `failed` or `cancelled`.
        state: String,
        /// Whatever the engine or the store reported, kept verbatim.
        failure: String,
    },

    /// The action a capture was told to run failed.
    #[error("the action that was to trigger a download failed: {reason}")]
    ActionFailed {
        /// The action's own message, kept verbatim.
        reason: String,
    },

    /// Downloads cannot be managed for this engine.
    #[error("managed downloads are not supported for the {engine} engine: {reason}")]
    Unsupported {
        /// Engine the caller asked for.
        engine: String,
        /// Why it cannot be supported, rather than a silent no-op.
        reason: String,
    },

    /// Talking to the browser failed.
    #[error("the browser refused to redirect its downloads: {reason}")]
    Transport {
        /// The engine's own message, kept verbatim.
        reason: String,
    },
}

#[cfg(test)]
pub mod test_support {
    //! Doubles shared by the tests in this module.
    //!
    //! They live here rather than in each file so that a watcher test and a
    //! manager test agree on what a sink does; a double that drifts between
    //! two test modules is a test that proves nothing.

    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use async_trait::async_trait;
    use serde_json::Value;

    use crate::downloads::sources::{DownloadFailure, DownloadSink, DownloadStart};
    use crate::downloads::store::DownloadSource;
    use crate::fingerprint::CdpTransport;

    /// A directory that removes itself when the test ends.
    pub struct TempDir(PathBuf);

    impl TempDir {
        /// Create a uniquely named directory under the system temp directory.
        pub fn new(name: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is after the epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!("{name}-{}-{nanos}", std::process::id()));
            std::fs::create_dir_all(&path).expect("temp directory is writable");
            Self(path)
        }

        /// The directory itself.
        pub fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A CDP transport that records what it was asked to send.
    #[derive(Default)]
    pub struct RecordingTransport {
        sent: Mutex<Vec<(String, Value)>>,
        refusal: Option<String>,
    }

    impl RecordingTransport {
        /// A transport that answers every command with an error.
        pub fn refusing(reason: &str) -> Self {
            Self {
                sent: Mutex::new(Vec::new()),
                refusal: Some(reason.to_string()),
            }
        }

        /// Every command that was sent, in order.
        pub fn sent(&self) -> Vec<(String, Value)> {
            self.sent.lock().expect("transport lock").clone()
        }
    }

    #[async_trait]
    impl CdpTransport for RecordingTransport {
        async fn send(&self, method: &str, params: Value) -> anyhow::Result<Value> {
            self.sent
                .lock()
                .expect("transport lock")
                .push((method.to_string(), params));
            match &self.refusal {
                Some(reason) => Err(anyhow::anyhow!(reason.clone())),
                None => Ok(Value::Null),
            }
        }
    }

    /// A sink that records the lifecycle calls a source makes.
    #[derive(Default)]
    pub struct RecordingSink {
        started: Mutex<Vec<DownloadStart>>,
        finished: Mutex<Vec<(String, DownloadSource)>>,
        failed: Mutex<Vec<(String, DownloadFailure, String)>>,
    }

    impl RecordingSink {
        /// The suggested filename of every download that was announced.
        pub fn started_names(&self) -> Vec<String> {
            self.started
                .lock()
                .expect("sink lock")
                .iter()
                .map(|start| start.suggested_filename.clone().unwrap_or_default())
                .collect()
        }

        /// How many downloads were handed over for saving.
        pub fn finished_count(&self) -> usize {
            self.finished.lock().expect("sink lock").len()
        }

        /// Every failure that was reported.
        pub fn failures(&self) -> Vec<(String, DownloadFailure, String)> {
            self.failed.lock().expect("sink lock").clone()
        }
    }

    #[async_trait]
    impl DownloadSink for RecordingSink {
        fn started(&self, start: DownloadStart) -> String {
            let mut started = self.started.lock().expect("sink lock");
            started.push(start);
            format!("dl-{:06}", started.len())
        }

        async fn finished(&self, id: String, source: DownloadSource) {
            self.finished.lock().expect("sink lock").push((id, source));
        }

        fn failed(&self, id: String, kind: DownloadFailure, reason: String) {
            self.failed
                .lock()
                .expect("sink lock")
                .push((id, kind, reason));
        }
    }
}
