//! A download source for engines with no download events (issue #88).
//!
//! Rust's CDP transport is request/response only: it can tell Chromium where to
//! put downloads, but it has no event stream to hear about them on, and
//! `fantoccini` has neither. Watching the staging directory is what gives both
//! the same managed lifecycle — including downloads a person started by hand,
//! because `Browser.setDownloadBehavior` is browser-wide.
//!
//! # Example
//!
//! ```rust
//! use browser_commander::downloads::DirectoryWatcher;
//!
//! let staging = std::env::temp_dir().join("bc-watcher-doc");
//! std::fs::create_dir_all(&staging)?;
//! let mut watcher = DirectoryWatcher::new(&staging);
//!
//! std::fs::write(staging.join("report.pdf"), b"%PDF-1.7")?;
//! // The first sighting only measures the file; a download is claimed once
//! // its size has stopped changing.
//! assert!(watcher.poll_once().is_empty());
//! assert_eq!(watcher.poll_once().len(), 1);
//! # std::fs::remove_dir_all(&staging)?;
//! # Ok::<(), std::io::Error>(())
//! ```

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use crate::downloads::sources::{
    prepare_staging_directory, DownloadSink, DownloadStart, SourceHandle,
};
use crate::downloads::store::DownloadSource;
use crate::downloads::DownloadError;

/// How often the staging directory is listed.
pub const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Suffixes Chromium uses while a file is still being written.
pub const IN_PROGRESS_SUFFIXES: [&str; 3] = ["crdownload", "tmp", "partial"];

/// A finished download found in the staging directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedDownload {
    /// Where the browser left the bytes.
    pub path: PathBuf,
    /// The name the browser gave the file, which is the name the page suggested.
    pub name: String,
}

/// Report files that appear in a staging directory and stop growing.
///
/// A file is only reported once its size has stopped changing: Chromium renames
/// `report.pdf.crdownload` to `report.pdf` when it is done, but a file that
/// merely exists is not evidence that its last byte was written.
#[derive(Debug)]
pub struct DirectoryWatcher {
    directory: PathBuf,
    sizes: HashMap<String, u64>,
    reported: HashSet<String>,
}

impl DirectoryWatcher {
    /// Start watching a directory.
    ///
    /// # Arguments
    ///
    /// * `directory` - Staging directory to watch
    ///
    /// # Returns
    ///
    /// A watcher that ignores everything already in the directory.
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        let directory = directory.into();
        // Files that were already there belong to an earlier session; claiming
        // them would report downloads this manager never saw.
        let reported = Self::candidates(&directory).into_iter().collect();
        Self {
            directory,
            sizes: HashMap::new(),
            reported,
        }
    }

    /// List the files that could be finished downloads.
    fn candidates(directory: &Path) -> Vec<String> {
        let Ok(entries) = std::fs::read_dir(directory) else {
            return Vec::new();
        };

        let mut names: Vec<String> = entries
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| !name.starts_with('.'))
            .filter(|name| {
                !IN_PROGRESS_SUFFIXES
                    .iter()
                    .any(|suffix| name.ends_with(&format!(".{suffix}")))
            })
            .collect();
        names.sort();
        names
    }

    /// Report every download that has finished since the last poll.
    ///
    /// # Returns
    ///
    /// The downloads claimed by this poll, in a stable order.
    pub fn poll_once(&mut self) -> Vec<StagedDownload> {
        let mut claimed = Vec::new();

        for name in Self::candidates(&self.directory) {
            if self.reported.contains(&name) {
                continue;
            }

            let path = self.directory.join(&name);
            let Ok(size) = std::fs::metadata(&path).map(|metadata| metadata.len()) else {
                continue;
            };

            // The first sighting only records the size; a file is claimed on
            // the poll that finds it unchanged.
            if self.sizes.get(&name) != Some(&size) {
                self.sizes.insert(name, size);
                continue;
            }

            self.sizes.remove(&name);
            self.reported.insert(name.clone());
            claimed.push(StagedDownload { path, name });
        }

        claimed
    }
}

/// Watch a staging directory and hand every finished download to a sink.
///
/// # Arguments
///
/// * `root` - Managed download directory
/// * `sink` - Where downloads are reported, usually the manager
/// * `interval` - How long to wait between directory listings
///
/// # Returns
///
/// A handle that stops the watcher.
///
/// # Errors
///
/// Returns [`DownloadError::DirectoryNotCreated`] when the staging directory
/// cannot be created.
pub fn attach_filesystem_watcher(
    root: &Path,
    sink: Arc<dyn DownloadSink>,
    interval: Duration,
) -> Result<SourceHandle, DownloadError> {
    let staging_directory = prepare_staging_directory(root)?;
    let mut watcher = DirectoryWatcher::new(&staging_directory);
    let (stop, mut stopped) = tokio::sync::oneshot::channel::<()>();

    let task = tokio::spawn({
        let sink = Arc::clone(&sink);
        async move {
            loop {
                tokio::select! {
                    _ = &mut stopped => break,
                    _ = tokio::time::sleep(interval) => {}
                }
                report(&mut watcher, &sink).await;
            }
            // One last look: a download that finished between the final poll
            // and this call is still the caller's file.
            report(&mut watcher, &sink).await;
        }
    });

    Ok(SourceHandle {
        staging_directory,
        detach: Box::new(move || {
            Box::pin(async move {
                let _ = stop.send(());
                let _ = task.await;
            })
        }),
    })
}

/// Hand one poll's worth of finished downloads to the sink.
async fn report(watcher: &mut DirectoryWatcher, sink: &Arc<dyn DownloadSink>) {
    for staged in watcher.poll_once() {
        let id = sink.started(DownloadStart {
            engine_handle: staged.path.to_string_lossy().into_owned(),
            url: Some(format!("file://{}", staged.path.to_string_lossy())),
            suggested_filename: Some(staged.name),
            mime_type: None,
        });
        // Awaited rather than spawned: the watcher's loop is the only thing
        // holding this work, so returning before the bytes are placed would
        // let `dispose()` finish with a `.partial` file as the only trace.
        sink.finished(id, DownloadSource::staged(staged.path)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::downloads::test_support::{RecordingSink, TempDir};

    /// Write `contents` into the staging directory.
    fn write(directory: &Path, name: &str, contents: &[u8]) {
        std::fs::write(directory.join(name), contents).unwrap();
    }

    #[test]
    fn claims_a_file_only_once_it_has_stopped_growing() {
        let temp = TempDir::new("bc-watch-growing");
        let mut watcher = DirectoryWatcher::new(temp.path());

        write(temp.path(), "report.pdf", b"half");
        assert!(watcher.poll_once().is_empty(), "claimed a growing file");

        write(temp.path(), "report.pdf", b"half and the rest");
        assert!(watcher.poll_once().is_empty(), "claimed a growing file");

        let claimed = watcher.poll_once();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].name, "report.pdf");
        assert_eq!(claimed[0].path, temp.path().join("report.pdf"));
    }

    #[test]
    fn claims_a_download_exactly_once() {
        let temp = TempDir::new("bc-watch-once");
        let mut watcher = DirectoryWatcher::new(temp.path());

        write(temp.path(), "report.pdf", b"body");
        watcher.poll_once();
        assert_eq!(watcher.poll_once().len(), 1);
        assert!(
            watcher.poll_once().is_empty(),
            "claimed the same file twice"
        );
    }

    #[test]
    fn ignores_files_chromium_is_still_writing() {
        let temp = TempDir::new("bc-watch-inprogress");
        let mut watcher = DirectoryWatcher::new(temp.path());

        write(temp.path(), "report.pdf.crdownload", b"body");
        write(temp.path(), "notes.txt.tmp", b"body");
        write(temp.path(), ".hidden", b"body");
        watcher.poll_once();

        assert!(watcher.poll_once().is_empty());
    }

    #[test]
    fn ignores_files_that_were_there_before_the_session() {
        let temp = TempDir::new("bc-watch-existing");
        write(temp.path(), "from-yesterday.pdf", b"body");

        let mut watcher = DirectoryWatcher::new(temp.path());
        watcher.poll_once();

        // Reporting a file this manager never saw arrive would claim somebody
        // else's download as this session's.
        assert!(watcher.poll_once().is_empty());
    }

    #[test]
    fn survives_a_directory_that_is_not_there() {
        let temp = TempDir::new("bc-watch-missing");
        let mut watcher = DirectoryWatcher::new(temp.path().join("never-created"));

        assert!(watcher.poll_once().is_empty());
    }

    #[tokio::test]
    async fn saves_what_the_browser_left_in_the_staging_directory() {
        let temp = TempDir::new("bc-watch-attach");
        let root = temp.path().join("downloads");
        let sink = Arc::new(RecordingSink::default());

        let handle = attach_filesystem_watcher(
            &root,
            Arc::clone(&sink) as Arc<dyn DownloadSink>,
            Duration::from_millis(10),
        )
        .unwrap();
        write(&handle.staging_directory, "report.pdf", b"%PDF-1.7");
        tokio::time::sleep(Duration::from_millis(60)).await;
        (handle.detach)().await;

        let seen = sink.started_names();
        assert_eq!(seen, vec!["report.pdf".to_string()]);
        assert_eq!(sink.finished_count(), 1);
    }

    #[tokio::test]
    async fn takes_one_last_look_when_it_is_detached() {
        let temp = TempDir::new("bc-watch-last-look");
        let root = temp.path().join("downloads");
        let sink = Arc::new(RecordingSink::default());

        let handle = attach_filesystem_watcher(
            &root,
            Arc::clone(&sink) as Arc<dyn DownloadSink>,
            Duration::from_millis(50),
        )
        .unwrap();
        // One poll measures the file, and the next one would claim it; the
        // detach happens first, so only the final look can report it.
        write(&handle.staging_directory, "late.pdf", b"body");
        tokio::time::sleep(Duration::from_millis(80)).await;
        (handle.detach)().await;

        assert_eq!(sink.started_names(), vec!["late.pdf".to_string()]);
    }
}
