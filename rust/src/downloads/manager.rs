//! The managed download lifecycle (issue #88).
//!
//! One manager owns every download a browser performs — automated or started
//! by a person — and answers three questions an engine event cannot:
//!
//! - where did the file end up, and is it still there after the browser closed;
//! - was it saved once, even though a global listener and an awaited
//!   [`DownloadManager::capture`] both watched it;
//! - did it actually complete, or is the caller about to open a half-written
//!   file that a cancelled download left behind.
//!
//! # Example
//!
//! ```rust,no_run
//! use browser_commander::downloads::{CaptureOptions, DownloadManager, DownloadOptions};
//!
//! # async fn example(page: &browser_commander::browser::ChromiumoxidePage)
//! # -> anyhow::Result<()> {
//! let manager = DownloadManager::create(DownloadOptions::default())?;
//! manager.attach(page).await?;
//!
//! let artifact = manager
//!     .capture(CaptureOptions::named("report.pdf"), async {
//!         // click the link that starts the download
//!         Ok(())
//!     })
//!     .await?;
//! println!("{} bytes", artifact.bytes.unwrap_or_default());
//! manager.dispose().await;
//! # Ok(())
//! # }
//! ```

use std::fmt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use tokio::sync::{broadcast, oneshot, Notify};

use crate::downloads::destination::{prepare_download_directory, resolve_download_directory};
use crate::downloads::options::{CaptureOptions, DownloadArtifact, DownloadEvent, DownloadOptions};
use crate::downloads::sources::{
    prepare_staging_directory, set_download_behavior, DownloadFailure, DownloadSink, DownloadStart,
    SourceHandle,
};
use crate::downloads::store::{
    save_download, DownloadConflict, DownloadNamer, DownloadSource, DownloadValidator, SaveRequest,
};
use crate::downloads::watcher::{attach_filesystem_watcher, DEFAULT_POLL_INTERVAL};
use crate::downloads::DownloadError;
use crate::fingerprint::CdpTransport;

/// How long [`DownloadManager::capture`] waits for a download by default.
pub const DEFAULT_CAPTURE_TIMEOUT: Duration = Duration::from_millis(30_000);

/// How many settled downloads a slow subscriber may fall behind by.
const EVENT_BUFFER: usize = 256;

/// Monotonic part of a download ID, so IDs are stable and ordered.
static DOWNLOAD_COUNTER: AtomicU64 = AtomicU64::new(0);

/// One download, plus the rules whichever capture claimed it attached.
struct Record {
    artifact: DownloadArtifact,
    filename: Option<DownloadNamer>,
    validate: Option<DownloadValidator>,
    conflict: Option<DownloadConflict>,
}

/// One armed [`DownloadManager::capture`] waiting for the download it triggered.
struct Waiter {
    token: u64,
    armed_at: usize,
    options: CaptureOptions,
    settle: Option<oneshot::Sender<DownloadArtifact>>,
}

/// Everything the manager mutates, behind one lock.
#[derive(Default)]
struct State {
    records: Vec<Record>,
    by_handle: std::collections::HashMap<String, usize>,
    by_id: std::collections::HashMap<String, usize>,
    published: std::collections::HashSet<String>,
    waiters: Vec<Waiter>,
    next_token: u64,
}

/// One managed download lifecycle for a browser.
pub struct DownloadManager {
    /// The directory downloads are saved into.
    pub directory: PathBuf,
    /// Whether files outlive the browser. Always true today.
    pub persist: bool,
    conflict: DownloadConflict,
    filename: Option<DownloadNamer>,
    validate: Option<DownloadValidator>,
    poll_interval: Duration,
    state: Mutex<State>,
    events: broadcast::Sender<DownloadArtifact>,
    in_flight: AtomicUsize,
    settled: Notify,
    sources: Mutex<Vec<SourceHandle>>,
}

impl fmt::Debug for DownloadManager {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DownloadManager")
            .field("directory", &self.directory)
            .field("persist", &self.persist)
            .field("conflict", &self.conflict)
            .finish_non_exhaustive()
    }
}

impl DownloadManager {
    /// Create a manager with a prepared download directory.
    ///
    /// The directory is resolved and probed before a single download can
    /// start: a permission problem found afterwards looks exactly like a file
    /// that never arrived.
    ///
    /// # Arguments
    ///
    /// * `options` - How downloads should be managed
    ///
    /// # Returns
    ///
    /// A manager with no source attached yet.
    ///
    /// # Errors
    ///
    /// Returns [`DownloadError::RelativeDirectory`],
    /// [`DownloadError::DirectoryNotCreated`] or
    /// [`DownloadError::DirectoryNotWritable`].
    pub fn create(options: DownloadOptions) -> Result<Arc<Self>, DownloadError> {
        let root =
            prepare_download_directory(&resolve_download_directory(options.directory.as_deref())?)?;

        Ok(Arc::new(Self {
            directory: root,
            persist: options.persist,
            conflict: options.conflict,
            filename: options.filename,
            validate: options.validate,
            poll_interval: options.poll_interval.unwrap_or(DEFAULT_POLL_INTERVAL),
            state: Mutex::new(State::default()),
            events: broadcast::channel(EVENT_BUFFER).0,
            in_flight: AtomicUsize::new(0),
            settled: Notify::new(),
            sources: Mutex::new(Vec::new()),
        }))
    }

    /// Point a browser's downloads at this manager.
    ///
    /// `Browser.setDownloadBehavior` is browser-wide, which is what makes a
    /// download a *person* started observable too, and the directory watcher
    /// is what stands in for the event stream this crate's CDP transport does
    /// not have.
    ///
    /// # Arguments
    ///
    /// * `transport` - A CDP connection with Browser-domain access
    ///
    /// # Errors
    ///
    /// Returns [`DownloadError::Transport`] when the browser refuses to
    /// redirect its downloads, which is how an attached browser that denies
    /// the Browser domain reports itself.
    pub async fn attach(
        self: &Arc<Self>,
        transport: &dyn CdpTransport,
    ) -> Result<(), DownloadError> {
        let staging = prepare_staging_directory(&self.directory)?;
        set_download_behavior(transport, &staging)
            .await
            .map_err(|error| DownloadError::Transport {
                reason: error.to_string(),
            })?;

        let handle = attach_filesystem_watcher(
            &self.directory,
            Arc::clone(self) as Arc<dyn DownloadSink>,
            self.poll_interval,
        )?;
        self.sources.lock().expect("manager lock").push(handle);
        Ok(())
    }

    /// List every download seen in this session.
    ///
    /// # Returns
    ///
    /// Artifacts in the order they started.
    pub fn list(&self) -> Vec<DownloadArtifact> {
        self.state
            .lock()
            .expect("manager lock")
            .records
            .iter()
            .map(|record| record.artifact.clone())
            .collect()
    }

    /// Watch every download as it settles.
    ///
    /// # Returns
    ///
    /// A receiver of settled artifacts, plus the `started` announcement.
    pub fn subscribe(&self) -> broadcast::Receiver<DownloadArtifact> {
        self.events.subscribe()
    }

    /// Wait until every download the manager has seen has been placed.
    pub async fn idle(&self) {
        loop {
            let notified = self.settled.notified();
            tokio::pin!(notified);
            // Registered before the count is read: a save that finishes in
            // between would otherwise notify nobody and this would wait for a
            // wake-up that already happened.
            notified.as_mut().enable();
            if self.in_flight.load(Ordering::SeqCst) == 0 {
                return;
            }
            notified.await;
        }
    }

    /// Wait for a download, triggering it first.
    ///
    /// The waiter and this capture's naming rules are armed *before* `action`
    /// is awaited. A download can start, finish and be saved inside the
    /// action, so attaching them afterwards would save the file under the
    /// wrong name and skip the caller's validation entirely.
    ///
    /// # Arguments
    ///
    /// * `options` - Naming, validation, conflict policy and budget
    /// * `action` - What triggers the download
    ///
    /// # Returns
    ///
    /// The completed artifact.
    ///
    /// # Errors
    ///
    /// Returns [`DownloadError::ActionFailed`] when the action itself failed,
    /// [`DownloadError::CaptureTimeout`] when nothing settled inside the
    /// budget, and [`DownloadError::DownloadFailed`] when the download failed
    /// or was cancelled — a capture never reports a file that is not there.
    pub async fn capture<F>(
        &self,
        options: CaptureOptions,
        action: F,
    ) -> Result<DownloadArtifact, DownloadError>
    where
        F: std::future::Future<Output = anyhow::Result<()>>,
    {
        let timeout = options.timeout.unwrap_or(DEFAULT_CAPTURE_TIMEOUT);
        let (settle, settled) = oneshot::channel();
        let token = {
            let mut state = self.state.lock().expect("manager lock");
            let token = state.next_token;
            state.next_token += 1;
            let armed_at = state.records.len();
            state.waiters.push(Waiter {
                token,
                armed_at,
                options,
                settle: Some(settle),
            });
            token
        };

        if let Err(error) = action.await {
            self.discard(token);
            return Err(DownloadError::ActionFailed {
                reason: error.to_string(),
            });
        }

        let artifact = match tokio::time::timeout(timeout, settled).await {
            Ok(Ok(artifact)) => artifact,
            _ => {
                self.discard(token);
                return Err(DownloadError::CaptureTimeout {
                    timeout_ms: timeout.as_millis() as u64,
                });
            }
        };
        self.discard(token);

        if artifact.state != DownloadEvent::Completed {
            return Err(DownloadError::DownloadFailed {
                id: artifact.id,
                state: artifact.state.to_string(),
                failure: artifact.failure.unwrap_or_default(),
            });
        }
        Ok(artifact)
    }

    /// Stop observing downloads.
    ///
    /// Saved files are untouched: persistence is the point of the manager, so
    /// detaching must never be the thing that removes a user's file.
    pub async fn dispose(&self) {
        // A download still being written is finished first: detaching must not
        // be the reason a file only ever exists under its `.partial` name.
        self.idle().await;
        let handles: Vec<SourceHandle> =
            std::mem::take(self.sources.lock().expect("manager lock").as_mut());
        for handle in handles {
            (handle.detach)().await;
        }
        // The detach takes one last look at the staging directory, so a
        // download that arrived during the first `idle()` is placed too.
        self.idle().await;
    }

    /// Forget a waiter that is no longer waiting.
    fn discard(&self, token: u64) {
        self.state
            .lock()
            .expect("manager lock")
            .waiters
            .retain(|waiter| waiter.token != token);
    }

    /// Build the save request for a download that is still in flight.
    ///
    /// Returns `None` when the download has already settled, which is what
    /// stops a second source — or a replayed event — from saving it twice.
    fn save_request(&self, id: &str, source: DownloadSource) -> Option<SaveRequest> {
        let state = self.state.lock().expect("manager lock");
        let record = state.by_id.get(id).map(|index| &state.records[*index])?;
        if record.artifact.state != DownloadEvent::Started {
            return None;
        }

        Some(SaveRequest {
            root: self.directory.clone(),
            source,
            suggested_filename: record
                .artifact
                .suggested_filename
                .clone()
                .unwrap_or_default(),
            mime_type: record.artifact.mime_type.clone(),
            conflict: record.conflict.unwrap_or(self.conflict),
            filename: record.filename.clone().or_else(|| self.filename.clone()),
            validate: record.validate.clone().or_else(|| self.validate.clone()),
        })
    }

    /// Publish an artifact under its final state exactly once.
    ///
    /// A download reaches its end once. Both a subscriber and an awaited
    /// `capture()` read from this same record, so publishing twice would mean
    /// one file reported as two.
    fn publish(&self, id: &str, state: DownloadEvent, update: impl FnOnce(&mut DownloadArtifact)) {
        let artifact = {
            let mut locked = self.state.lock().expect("manager lock");
            if !locked.published.insert(id.to_string()) {
                return;
            }
            let Some(index) = locked.by_id.get(id).copied() else {
                return;
            };
            let record = &mut locked.records[index];
            record.artifact.state = state;
            update(&mut record.artifact);
            let artifact = record.artifact.clone();

            // Every waiter armed before this download started gets it: the one
            // that triggered it cannot be told apart from one armed a moment
            // earlier, and reporting it to both is better than losing it.
            for waiter in std::mem::take(&mut locked.waiters) {
                if index >= waiter.armed_at {
                    if let Some(settle) = waiter.settle {
                        let _ = settle.send(artifact.clone());
                    }
                } else {
                    locked.waiters.push(waiter);
                }
            }
            artifact
        };
        let _ = self.events.send(artifact);
    }

    /// Note that a save has started, so `idle()` waits for it.
    fn begin_work(&self) {
        self.in_flight.fetch_add(1, Ordering::SeqCst);
    }

    /// Note that a save has finished.
    fn end_work(&self) {
        if self.in_flight.fetch_sub(1, Ordering::SeqCst) == 1 {
            self.settled.notify_waiters();
        }
    }
}

#[async_trait]
impl DownloadSink for DownloadManager {
    fn started(&self, start: DownloadStart) -> String {
        let mut state = self.state.lock().expect("manager lock");
        // One engine download can be announced twice — two sources, or a poll
        // that overlaps a rename — so the engine's own handle is the identity,
        // not the order events arrived in. Only a download that has not settled
        // yet is merged: a browser is free to reuse a handle once the file it
        // named is gone, and a second download must not disappear into the
        // record of the first.
        if let Some(index) = state.by_handle.get(&start.engine_handle).copied() {
            if state.records[index].artifact.state == DownloadEvent::Started {
                return state.records[index].artifact.id.clone();
            }
        }

        let id = format!(
            "dl-{:06}",
            DOWNLOAD_COUNTER.fetch_add(1, Ordering::SeqCst) + 1
        );
        let artifact = DownloadArtifact {
            id: id.clone(),
            url: start.url,
            suggested_filename: start.suggested_filename,
            state: DownloadEvent::Started,
            started_at: iso8601(SystemTime::now()),
            completed_at: None,
            path: None,
            mime_type: start.mime_type,
            bytes: None,
            checksum: None,
            failure: None,
        };

        // Per-download rules are attached as the download starts, so a capture
        // armed afterwards cannot rename a download it did not trigger.
        let index = state.records.len();
        let claimed = state
            .waiters
            .iter()
            .find(|waiter| index >= waiter.armed_at)
            .map(|waiter| waiter.options.clone());

        state.records.push(Record {
            artifact: artifact.clone(),
            filename: claimed
                .as_ref()
                .and_then(|options| options.filename.clone()),
            validate: claimed
                .as_ref()
                .and_then(|options| options.validate.clone()),
            conflict: claimed.as_ref().and_then(|options| options.conflict),
        });
        state.by_handle.insert(start.engine_handle, index);
        state.by_id.insert(id.clone(), index);
        drop(state);

        let _ = self.events.send(artifact);
        id
    }

    async fn finished(&self, id: String, source: DownloadSource) {
        let Some(request) = self.save_request(&id, source) else {
            return;
        };

        self.begin_work();
        let saved = tokio::task::spawn_blocking(move || save_download(request))
            .await
            .unwrap_or_else(|error| {
                Err(DownloadError::ActionFailed {
                    reason: error.to_string(),
                })
            });

        match saved {
            Ok(saved) => self.publish(&id, DownloadEvent::Completed, |artifact| {
                artifact.path = Some(saved.path);
                artifact.bytes = Some(saved.bytes);
                artifact.checksum = Some(saved.checksum);
                artifact.completed_at = Some(iso8601(SystemTime::now()));
            }),
            // Reported, never raised at the engine: a source is a background
            // task, and a download that could not be saved is a fact the
            // caller needs, not a panic in a task nobody is awaiting.
            Err(error) => self.publish(&id, DownloadEvent::Failed, |artifact| {
                artifact.failure = Some(error.to_string());
                artifact.completed_at = Some(iso8601(SystemTime::now()));
            }),
        }
        self.end_work();
    }

    fn failed(&self, id: String, kind: DownloadFailure, reason: String) {
        let state = match kind {
            DownloadFailure::Cancelled => DownloadEvent::Cancelled,
            DownloadFailure::Failed => DownloadEvent::Failed,
        };
        self.publish(&id, state, |artifact| {
            artifact.failure = Some(reason);
            artifact.completed_at = Some(iso8601(SystemTime::now()));
        });
    }
}

/// Render a moment the way every other language in the library writes it.
///
/// The bundle format and the Python and JavaScript managers all use ISO-8601 in
/// UTC, so a Rust artifact has to as well or the three languages would describe
/// the same download with timestamps that cannot be compared. No date crate is
/// a dependency here, and adding one to print eleven fields is a poor trade.
///
/// # Arguments
///
/// * `time` - The moment to render
///
/// # Returns
///
/// `1970-01-01T00:00:00.000Z` and friends.
fn iso8601(time: SystemTime) -> String {
    let since_epoch = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = since_epoch.as_secs() as i64;
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let seconds_of_day = seconds.rem_euclid(86_400);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        seconds_of_day / 3600,
        (seconds_of_day % 3600) / 60,
        seconds_of_day % 60,
        since_epoch.subsec_millis()
    )
}

/// Turn a count of days since 1970-01-01 into a calendar date.
///
/// Howard Hinnant's `civil_from_days`, which is exact for every date the
/// proleptic Gregorian calendar covers and needs no lookup tables.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    // Shift the epoch to 0000-03-01 so that the leap day is the last day of
    // the year and every four-century era has the same length.
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_position + 2) / 5 + 1;
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    };

    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::downloads::store::DownloadCandidate;
    use crate::downloads::test_support::TempDir;

    /// A manager saving into a directory of its own.
    fn manager(temp: &TempDir, options: DownloadOptions) -> Arc<DownloadManager> {
        DownloadManager::create(DownloadOptions {
            directory: Some(temp.path().join("downloads").to_string_lossy().into_owned()),
            ..options
        })
        .expect("manager")
    }

    /// Pretend the engine wrote a file into the staging directory.
    fn staged(manager: &DownloadManager, name: &str, contents: &[u8]) -> DownloadSource {
        let staging = prepare_staging_directory(&manager.directory).expect("staging");
        let path = staging.join(name);
        std::fs::write(&path, contents).expect("staged file is writable");
        DownloadSource::staged(path)
    }

    /// Announce and place one download, the way a source does.
    async fn deliver(manager: &Arc<DownloadManager>, name: &str, contents: &[u8]) -> String {
        let source = staged(manager, name, contents);
        let id = manager.started(DownloadStart {
            engine_handle: source.path.to_string_lossy().into_owned(),
            suggested_filename: Some(name.to_string()),
            ..DownloadStart::default()
        });
        manager.finished(id.clone(), source).await;
        id
    }

    #[tokio::test]
    async fn saves_a_download_where_the_caller_can_find_it_later() {
        let temp = TempDir::new("bc-manager-save");
        let manager = manager(&temp, DownloadOptions::default());

        deliver(&manager, "report.pdf", b"%PDF-1.7 body").await;

        let artifacts = manager.list();
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].state, DownloadEvent::Completed);
        let path = artifacts[0].path.clone().expect("a completed download");
        assert_eq!(path, manager.directory.join("report.pdf"));
        assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.7 body");
        assert_eq!(artifacts[0].bytes, Some(13));
    }

    #[tokio::test]
    async fn keeps_the_file_after_everything_that_made_it_is_gone() {
        let temp = TempDir::new("bc-manager-persist");
        let manager = manager(&temp, DownloadOptions::default());

        deliver(&manager, "keep.txt", b"still here").await;
        let path = manager.list()[0]
            .path
            .clone()
            .expect("a completed download");
        manager.dispose().await;
        drop(manager);

        // Disposing is not deleting: persistence is the point of the manager.
        assert_eq!(std::fs::read(&path).unwrap(), b"still here");
    }

    #[tokio::test]
    async fn reports_one_download_once_however_many_sources_saw_it() {
        let temp = TempDir::new("bc-manager-dedupe");
        let manager = manager(&temp, DownloadOptions::default());
        let mut events = manager.subscribe();

        let source = staged(&manager, "once.txt", b"body");
        let handle = source.path.to_string_lossy().into_owned();
        let first = manager.started(DownloadStart {
            engine_handle: handle.clone(),
            suggested_filename: Some("once.txt".to_string()),
            ..DownloadStart::default()
        });
        let second = manager.started(DownloadStart {
            engine_handle: handle,
            suggested_filename: Some("once.txt".to_string()),
            ..DownloadStart::default()
        });
        assert_eq!(first, second, "the same file became two downloads");

        manager.finished(first.clone(), source.clone()).await;
        manager.finished(first, source).await;

        assert_eq!(manager.list().len(), 1);
        let completed: Vec<DownloadArtifact> = std::iter::from_fn(|| events.try_recv().ok())
            .filter(|artifact| artifact.state == DownloadEvent::Completed)
            .collect();
        assert_eq!(completed.len(), 1, "one file was reported as two");
        // A second save would have produced `once (2).txt` next to it.
        assert!(!manager.directory.join("once (2).txt").exists());
    }

    #[tokio::test]
    async fn names_a_download_that_finishes_inside_the_action() {
        let temp = TempDir::new("bc-manager-race");
        let manager = manager(&temp, DownloadOptions::default());

        // The download starts, finishes and is saved before `capture()` gets
        // to look at anything, which is exactly the race a fast download wins.
        let during = Arc::clone(&manager);
        let artifact = manager
            .capture(CaptureOptions::named("chosen.pdf"), async move {
                deliver(&during, "7f1c9ab2", b"%PDF-1.7").await;
                Ok(())
            })
            .await
            .expect("capture");

        assert_eq!(
            artifact.path,
            Some(manager.directory.join("chosen.pdf")),
            "the caller's name lost the race with the download"
        );
    }

    #[tokio::test]
    async fn saves_a_bare_uuid_under_a_name_a_person_can_open() {
        let temp = TempDir::new("bc-manager-uuid");
        let manager = manager(&temp, DownloadOptions::default());

        let artifact = manager
            .capture(
                CaptureOptions::named("statement.pdf").validated_by(Arc::new(
                    |candidate: &DownloadCandidate| {
                        let head = std::fs::read(&candidate.path)?;
                        Ok(head.starts_with(b"%PDF-"))
                    },
                )),
                {
                    let manager = Arc::clone(&manager);
                    async move {
                        deliver(&manager, "7f1c9ab2-4d3e", b"%PDF-1.7 statement").await;
                        Ok(())
                    }
                },
            )
            .await
            .expect("capture");

        assert_eq!(artifact.path, Some(manager.directory.join("statement.pdf")));
    }

    #[tokio::test]
    async fn refuses_to_call_a_rejected_download_a_success() {
        let temp = TempDir::new("bc-manager-reject");
        let manager = manager(&temp, DownloadOptions::default());

        let error = manager
            .capture(
                CaptureOptions::named("invoice.pdf")
                    .validated_by(Arc::new(|_candidate: &DownloadCandidate| Ok(false))),
                {
                    let manager = Arc::clone(&manager);
                    async move {
                        deliver(&manager, "invoice.pdf", b"<html>login</html>").await;
                        Ok(())
                    }
                },
            )
            .await
            .unwrap_err();

        assert!(
            error.to_string().contains("failed"),
            "unexpected message: {error}"
        );
        assert!(
            !manager.directory.join("invoice.pdf").exists(),
            "a rejected download was published anyway"
        );
    }

    #[tokio::test]
    async fn refuses_to_call_a_cancelled_download_a_success() {
        let temp = TempDir::new("bc-manager-cancel");
        let manager = manager(&temp, DownloadOptions::default());

        let during = Arc::clone(&manager);
        let error = manager
            .capture(CaptureOptions::default(), async move {
                let id = during.started(DownloadStart {
                    engine_handle: "handle-1".to_string(),
                    suggested_filename: Some("big.zip".to_string()),
                    ..DownloadStart::default()
                });
                during.failed(id, DownloadFailure::Cancelled, "Canceled".to_string());
                Ok(())
            })
            .await
            .unwrap_err();

        assert!(
            error.to_string().contains("cancelled: Canceled"),
            "unexpected message: {error}"
        );
    }

    #[tokio::test]
    async fn gives_up_when_no_download_arrives() {
        let temp = TempDir::new("bc-manager-timeout");
        let manager = manager(&temp, DownloadOptions::default());

        let error = manager
            .capture(
                CaptureOptions::default().within(Duration::from_millis(20)),
                async { Ok(()) },
            )
            .await
            .unwrap_err();

        assert!(
            error.to_string().contains("no download completed within"),
            "unexpected message: {error}"
        );
    }

    #[tokio::test]
    async fn reports_the_actions_own_failure_rather_than_a_timeout() {
        let temp = TempDir::new("bc-manager-action");
        let manager = manager(&temp, DownloadOptions::default());

        let error = manager
            .capture(CaptureOptions::default(), async {
                Err(anyhow::anyhow!("the link was not there"))
            })
            .await
            .unwrap_err();

        assert!(
            error.to_string().contains("the link was not there"),
            "unexpected message: {error}"
        );
    }

    #[tokio::test]
    async fn numbers_a_second_download_of_the_same_name() {
        let temp = TempDir::new("bc-manager-collision");
        let manager = manager(&temp, DownloadOptions::default());

        deliver(&manager, "report.pdf", b"first").await;
        deliver(&manager, "report.pdf", b"second").await;

        assert_eq!(
            std::fs::read(manager.directory.join("report.pdf")).unwrap(),
            b"first"
        );
        assert_eq!(
            std::fs::read(manager.directory.join("report (2).pdf")).unwrap(),
            b"second"
        );
    }

    #[tokio::test]
    async fn waits_for_a_download_still_being_written() {
        let temp = TempDir::new("bc-manager-idle");
        let manager = manager(&temp, DownloadOptions::default());

        let source = staged(&manager, "slow.bin", &vec![7u8; 512 * 1024]);
        let id = manager.started(DownloadStart {
            engine_handle: source.path.to_string_lossy().into_owned(),
            suggested_filename: Some("slow.bin".to_string()),
            ..DownloadStart::default()
        });
        let saving = tokio::spawn({
            let manager = Arc::clone(&manager);
            async move { manager.finished(id, source).await }
        });

        manager.idle().await;
        saving.await.expect("the save task");
        // `idle()` returning while bytes are still being written would leave a
        // `.partial` file as the only trace of the download.
        assert!(manager.directory.join("slow.bin").exists());
    }

    #[test]
    fn writes_a_timestamp_the_other_languages_can_read() {
        assert_eq!(iso8601(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso8601(UNIX_EPOCH + Duration::from_millis(1_700_000_000_123)),
            "2023-11-14T22:13:20.123Z"
        );
        // A leap day is where a hand-rolled calendar goes wrong first.
        assert_eq!(
            iso8601(UNIX_EPOCH + Duration::from_secs(1_709_164_800)),
            "2024-02-29T00:00:00.000Z"
        );
    }

    #[test]
    fn names_the_states_the_way_the_other_languages_do() {
        assert_eq!(DownloadEvent::Started.to_string(), "started");
        assert_eq!(DownloadEvent::Completed.to_string(), "completed");
        assert_eq!(DownloadEvent::Failed.to_string(), "failed");
        assert_eq!(DownloadEvent::Cancelled.to_string(), "cancelled");
    }
}
