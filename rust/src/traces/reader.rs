//! Reading a trace bundle (issue #87).
//!
//! The reader assumes nothing finished cleanly. A run that was killed leaves a
//! bundle with no manifest and a half-written last line; that bundle still
//! holds the evidence someone is looking for, so it is repaired on open rather
//! than rejected. This mirrors `js/src/traces/reader.js` and
//! `python/src/browser_commander/traces/reader.py`, down to the messages, so a
//! bundle reads the same whichever language opens it.
//!
//! # Example
//!
//! ```rust,no_run
//! use browser_commander::traces::{diff_control_state, read_trace};
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let trace = read_trace("./traces/run")?;
//! println!("{} events", trace.events.len());
//!
//! let before = trace.state(1)?;
//! let after = trace.state(2)?;
//! for change in diff_control_state(before.as_ref(), after.as_ref()) {
//!     println!("{} {}", change.change.as_str(), change.path.unwrap_or_default());
//! }
//! # Ok(())
//! # }
//! ```

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::schema::{
    assert_readable_manifest, sequence_name, TraceEvent, TraceFiles, TraceManifest, TraceMode,
    TraceOutcome, TRACE_SCHEMA_VERSION,
};

#[cfg(test)]
use super::schema::{TraceCheckpointReason, TraceLiveState, TraceMutationKind};

/// Everything that can stop a bundle from being read.
#[derive(Debug, thiserror::Error)]
pub enum TraceError {
    /// Neither a manifest nor a timeline was found at the path.
    #[error("no trace bundle at {path}")]
    NotFound {
        /// Directory that was opened.
        path: PathBuf,
    },
    /// A manifest exists but is not JSON this reader can parse.
    #[error("{manifest} in {path} is not readable JSON", manifest = TraceFiles::MANIFEST)]
    ManifestUnreadable {
        /// Directory that was opened.
        path: PathBuf,
    },
    /// The directory holds something else that happens to look similar.
    #[error("not a Browser Commander trace bundle")]
    NotATrace,
    /// The bundle was written by a newer version of the format.
    #[error("trace schema version {found} is newer than this reader ({TRACE_SCHEMA_VERSION})")]
    UnsupportedVersion {
        /// Version the bundle declares.
        found: u64,
    },
    /// A member could not be read from disk.
    #[error("cannot read {path}: {source}")]
    Io {
        /// Member that could not be read.
        path: PathBuf,
        /// What the filesystem reported.
        source: io::Error,
    },
    /// A member exists but does not hold the JSON its name promises.
    #[error("{path} is not readable JSON")]
    MemberUnreadable {
        /// Member that could not be parsed.
        path: PathBuf,
    },
}

/// What an NDJSON file held, and whether it ended mid-line.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedNdjson {
    /// Every record before the first unreadable line.
    pub records: Vec<Value>,
    /// Whether a line was cut short.
    pub truncated: bool,
}

/// One named moment, as the timeline describes it.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TraceCheckpoint {
    /// Checkpoint number, counting from one.
    pub index: Option<u32>,
    /// What the caller called it.
    pub name: Option<String>,
    /// Who asked for it: the caller, or the recorder itself.
    pub actor: Option<String>,
    /// Why the recorder took it, when nobody asked.
    pub reason: Option<String>,
    /// Where the page was.
    pub url: Option<String>,
    /// When it happened, in wall-clock time.
    pub at: Option<String>,
    /// Position on the timeline.
    pub sequence: Option<u64>,
    /// Bundle members the checkpoint wrote, by kind.
    pub members: Map<String, Value>,
}

/// Which way a control went between two checkpoints.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ControlChangeKind {
    /// The control was not there before.
    Added,
    /// The control held something else before.
    Changed,
    /// The control is not there any more.
    Removed,
}

impl ControlChangeKind {
    /// The name the other languages use for this change.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Added => "added",
            Self::Changed => "changed",
            Self::Removed => "removed",
        }
    }
}

impl std::fmt::Display for ControlChangeKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One control that differs between two checkpoints.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ControlChange {
    /// Selector path of the control.
    pub path: Option<String>,
    /// What happened to it.
    pub change: ControlChangeKind,
    /// What it held at the earlier checkpoint.
    pub before: Option<Value>,
    /// What it holds at the later checkpoint.
    pub after: Option<Value>,
}

/// An opened trace bundle.
#[derive(Debug, Clone)]
pub struct Trace {
    /// Directory the bundle was read from.
    pub path: PathBuf,
    /// What the run was and how it ended.
    pub manifest: TraceManifest,
    /// The one ordered timeline.
    pub events: Vec<Value>,
    /// The named moments on that timeline.
    pub checkpoints: Vec<TraceCheckpoint>,
    /// Whether records are missing from the bundle.
    pub truncated: bool,
}

fn read_if_present(path: &Path) -> Result<Option<String>, TraceError> {
    match fs::read_to_string(path) {
        Ok(body) => Ok(Some(body)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(TraceError::Io {
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn read_bytes_if_present(path: &Path) -> Result<Option<Vec<u8>>, TraceError> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(TraceError::Io {
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn absolute(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    std::env::current_dir()
        .map(|directory| directory.join(path))
        .unwrap_or_else(|_| path.to_path_buf())
}

fn text(event: &Value, field: &str) -> Option<String> {
    event.get(field)?.as_str().map(str::to_string)
}

/// Parse an NDJSON body, keeping everything before the first unreadable line.
///
/// A process killed mid-write leaves one partial line. Everything before it is
/// still true, so the file is readable up to that point.
pub fn parse_ndjson(body: Option<&str>) -> ParsedNdjson {
    let mut records = Vec::new();

    for line in body.unwrap_or("").split('\n') {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str(line) {
            Ok(record) => records.push(record),
            Err(_) => {
                return ParsedNdjson {
                    records,
                    truncated: true,
                }
            }
        }
    }

    ParsedNdjson {
        records,
        truncated: false,
    }
}

fn is_kind(event: &Value, kind: &str) -> bool {
    event.get("kind").and_then(Value::as_str) == Some(kind)
}

/// Rebuild a manifest for a run that never reached `stop()`.
///
/// The timeline is the record of what happened; the manifest is rebuilt around
/// it so a killed run still opens.
fn rebuild_manifest(events: &[Value]) -> TraceManifest {
    let started = events
        .iter()
        .find(|event| is_kind(event, TraceEvent::TRACE_START));

    TraceManifest {
        mode: Some(
            started
                .and_then(|event| text(event, "mode"))
                .unwrap_or_else(|| TraceMode::CHECKPOINTS.to_string()),
        ),
        outcome: TraceOutcome::TRUNCATED.to_string(),
        started_at: started.and_then(|event| text(event, "at")),
        stopped_at: events.last().and_then(|event| text(event, "at")),
        engine: started.and_then(|event| text(event, "engine")),
        events: started
            .and_then(|event| event.get("events"))
            .and_then(Value::as_array)
            .map(|sources| {
                sources
                    .iter()
                    .filter_map(|source| source.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
        dom: started
            .and_then(|event| event.get("dom"))
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default(),
        counts: super::schema::TraceCounts {
            events: events.len() as u64,
            checkpoints: events
                .iter()
                .filter(|event| is_kind(event, TraceEvent::CHECKPOINT))
                .count() as u64,
            mutation_batches: 0,
        },
        ..TraceManifest::default()
    }
}

/// Open a trace bundle.
///
/// # Errors
///
/// Returns an error when the directory holds no bundle, holds something that
/// is not a Browser Commander trace, or was written against a newer schema
/// version than this reader knows.
pub fn read_trace(bundle_path: impl AsRef<Path>) -> Result<Trace, TraceError> {
    let root = absolute(bundle_path.as_ref());
    let manifest_body = read_if_present(&root.join(TraceFiles::MANIFEST))?;
    let events_body = read_if_present(&root.join(TraceFiles::EVENTS))?;

    if manifest_body.is_none() && events_body.is_none() {
        return Err(TraceError::NotFound { path: root });
    }

    let parsed = parse_ndjson(events_body.as_deref());

    let manifest = match manifest_body {
        None => rebuild_manifest(&parsed.records),
        Some(body) => {
            let manifest: TraceManifest = serde_json::from_str(&body)
                .map_err(|_| TraceError::ManifestUnreadable { path: root.clone() })?;
            assert_readable_manifest(&manifest)?;
            manifest
        }
    };

    let checkpoints = parsed
        .records
        .iter()
        .filter(|event| is_kind(event, TraceEvent::CHECKPOINT))
        .map(|event| TraceCheckpoint {
            index: event
                .get("index")
                .and_then(Value::as_u64)
                .map(|index| index as u32),
            name: text(event, "name"),
            actor: text(event, "actor"),
            reason: text(event, "reason"),
            url: text(event, "url"),
            at: text(event, "at"),
            sequence: event.get("sequence").and_then(Value::as_u64),
            members: event
                .get("members")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default(),
        })
        .collect();

    let truncated = parsed.truncated || !manifest.is_complete();

    Ok(Trace {
        path: root,
        manifest,
        events: parsed.records,
        checkpoints,
        truncated,
    })
}

impl Trace {
    fn checkpoint_member(&self, index: u32, suffix: &str) -> PathBuf {
        self.path
            .join(TraceFiles::CHECKPOINTS_DIR)
            .join(format!("{}{suffix}", sequence_name(index)))
    }

    /// Read one checkpoint's HTML.
    ///
    /// # Errors
    ///
    /// Returns an error when the member exists but cannot be read.
    pub fn html(&self, index: u32) -> Result<Option<String>, TraceError> {
        read_if_present(&self.checkpoint_member(index, ".html"))
    }

    /// Read one checkpoint's live control state.
    ///
    /// # Errors
    ///
    /// Returns an error when the member exists but is not readable JSON.
    pub fn state(&self, index: u32) -> Result<Option<Value>, TraceError> {
        let member = self.checkpoint_member(index, ".state.json");
        match read_if_present(&member)? {
            None => Ok(None),
            Some(body) => serde_json::from_str(&body)
                .map(Some)
                .map_err(|_| TraceError::MemberUnreadable { path: member }),
        }
    }

    /// Read one checkpoint's screenshot, when the recorder took one.
    ///
    /// # Errors
    ///
    /// Returns an error when the member exists but cannot be read.
    pub fn screenshot(&self, index: u32) -> Result<Option<Vec<u8>>, TraceError> {
        read_bytes_if_present(&self.checkpoint_member(index, ".png"))
    }

    /// Read the mutation batches recorded after one checkpoint.
    ///
    /// # Errors
    ///
    /// Returns an error when the member exists but cannot be read.
    pub fn mutations(&self, index: u32) -> Result<Vec<Value>, TraceError> {
        let member = self
            .path
            .join(TraceFiles::MUTATIONS_DIR)
            .join(format!("{}.ndjson", sequence_name(index)));
        Ok(parse_ndjson(read_if_present(&member)?.as_deref()).records)
    }
}

fn controls(state: Option<&Value>) -> Vec<&Value> {
    state
        .and_then(|state| state.get("controls"))
        .and_then(Value::as_array)
        .map(|controls| controls.iter().collect())
        .unwrap_or_default()
}

fn control_path(control: &Value) -> Option<String> {
    control
        .get("path")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn field(control: &Value, name: &str) -> Option<Value> {
    match control.get(name) {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.clone()),
    }
}

/// The value a change is reported in terms of.
///
/// A checkbox changes by what it is checked to, not by the value it submits,
/// so the reader reports the field the reviewer is actually looking at.
fn control_value(control: &Value) -> Option<Value> {
    match field(control, "checked") {
        None => field(control, "value"),
        checked => checked,
    }
}

/// Diff two checkpoints' control state.
///
/// `before`/`after` per control is the shape a reviewer needs to answer "what
/// did this step change?" without reading two HTML files side by side.
pub fn diff_control_state(before: Option<&Value>, after: Option<&Value>) -> Vec<ControlChange> {
    // An ordered list, not a map: controls that disappeared are reported in
    // the order the earlier checkpoint saw them, as the other readers do.
    let mut earlier: Vec<(Option<String>, &Value, bool)> = controls(before)
        .into_iter()
        .map(|control| (control_path(control), control, false))
        .collect();
    let mut changes = Vec::new();

    for control in controls(after) {
        let path = control_path(control);
        let previous = earlier
            .iter_mut()
            .find(|(seen, _, taken)| !*taken && *seen == path);

        let Some((_, previous, taken)) = previous else {
            changes.push(ControlChange {
                path,
                change: ControlChangeKind::Added,
                before: None,
                after: field(control, "value"),
            });
            continue;
        };
        *taken = true;

        if field(previous, "value") != field(control, "value")
            || field(previous, "checked") != field(control, "checked")
        {
            changes.push(ControlChange {
                path,
                change: ControlChangeKind::Changed,
                before: control_value(previous),
                after: control_value(control),
            });
        }
    }

    changes.extend(earlier.into_iter().filter(|(_, _, taken)| !*taken).map(
        |(path, control, _)| ControlChange {
            path,
            change: ControlChangeKind::Removed,
            before: field(control, "value"),
            after: None,
        },
    ));

    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A directory that removes itself, so a failing test leaves no litter.
    ///
    /// The crate has no `tempfile` dev-dependency, and one reader test is not
    /// a reason to add one.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock is after the epoch")
                .as_nanos();
            let path = std::env::temp_dir()
                .join(format!("bc-trace-{name}-{}-{nanos}", std::process::id()));
            fs::create_dir_all(&path).expect("temp directory is writable");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Render records the way the recorder appends them.
    fn ndjson(records: &[Value]) -> String {
        records
            .iter()
            .map(|record| format!("{record}\n"))
            .collect::<String>()
    }

    fn write(path: &Path, body: &str) {
        fs::create_dir_all(path.parent().expect("member has a parent"))
            .expect("bundle directory is writable");
        fs::write(path, body).expect("member is writable");
    }

    /// Write a small bundle the tests can read back.
    ///
    /// A bundle that was not closed has no manifest, exactly like a run that
    /// was killed. The bytes are the ones the JavaScript recorder writes, so a
    /// change on either side that breaks the agreement fails here.
    fn write_bundle(root: &Path, close: bool) -> PathBuf {
        write(
            &root.join(TraceFiles::CHECKPOINTS_DIR).join("0001.html"),
            "<html><body>one</body></html>",
        );
        write(
            &root
                .join(TraceFiles::CHECKPOINTS_DIR)
                .join("0001.state.json"),
            &json!({
                "url": "https://example.com/one",
                "controls": [{"path": "input", "value": "before"}],
            })
            .to_string(),
        );
        write(
            &root.join(TraceFiles::MUTATIONS_DIR).join("0001.ndjson"),
            &ndjson(&[json!({"records": [{"type": "childList"}]})]),
        );
        write(
            &root.join(TraceFiles::EVENTS),
            &ndjson(&[
                json!({
                    "kind": TraceEvent::TRACE_START,
                    "sequence": 1,
                    "at": "2026-01-01T00:00:00.000Z",
                    "mode": TraceMode::CHECKPOINTS,
                    "engine": "playwright",
                    "events": ["console"],
                }),
                json!({
                    "kind": TraceEvent::CHECKPOINT,
                    "sequence": 2,
                    "at": "2026-01-01T00:00:01.000Z",
                    "index": 1,
                    "name": "start",
                    "actor": "automation",
                    "reason": "checkpoint",
                    "url": "https://example.com/one",
                    "members": {
                        "html": "checkpoints/0001.html",
                        "state": "checkpoints/0001.state.json",
                    },
                }),
            ]),
        );

        if close {
            write(
                &root.join(TraceFiles::MANIFEST),
                &json!({
                    "schemaVersion": TRACE_SCHEMA_VERSION,
                    "format": super::super::schema::TRACE_FORMAT,
                    "mode": TraceMode::CHECKPOINTS,
                    "outcome": TraceOutcome::COMPLETE,
                    "engine": "playwright",
                    "counts": {"checkpoints": 1, "events": 2, "mutationBatches": 1},
                })
                .to_string(),
            );
        }

        root.to_path_buf()
    }

    #[test]
    fn keeps_everything_before_a_half_written_line() {
        let parsed = parse_ndjson(Some("{\"a\":1}\n{\"b\":2}\n{\"c\":"));

        assert_eq!(parsed.records, vec![json!({"a": 1}), json!({"b": 2})]);
        assert!(parsed.truncated);
    }

    #[test]
    fn reads_an_empty_body_as_an_empty_timeline() {
        let parsed = parse_ndjson(None);

        assert!(parsed.records.is_empty());
        assert!(!parsed.truncated);
    }

    #[test]
    fn reads_the_manifest_timeline_and_checkpoint_members() {
        let temp = TempDir::new("read");
        let root = write_bundle(&temp.path().join("run"), true);

        let trace = read_trace(&root).expect("bundle is readable");

        assert_eq!(trace.manifest.outcome, TraceOutcome::COMPLETE);
        assert_eq!(trace.checkpoints.len(), 1);
        assert_eq!(trace.checkpoints[0].name.as_deref(), Some("start"));
        assert_eq!(
            trace.checkpoints[0].members["html"],
            json!("checkpoints/0001.html")
        );
        assert!(trace
            .html(1)
            .expect("html is readable")
            .expect("html was written")
            .contains("one"));
        assert_eq!(
            trace
                .state(1)
                .expect("state is readable")
                .expect("state was written")["url"],
            json!("https://example.com/one")
        );
        assert_eq!(trace.mutations(1).expect("mutations are readable").len(), 1);
        assert!(!trace.truncated);
    }

    #[test]
    fn returns_nothing_for_a_checkpoint_member_that_was_dropped() {
        let temp = TempDir::new("dropped");
        let root = write_bundle(&temp.path().join("run"), true);

        let trace = read_trace(&root).expect("bundle is readable");

        assert!(trace
            .html(2)
            .expect("missing html is not an error")
            .is_none());
        assert!(trace
            .state(2)
            .expect("missing state is not an error")
            .is_none());
        assert!(trace
            .screenshot(1)
            .expect("missing screenshot is not an error")
            .is_none());
        assert!(trace
            .mutations(2)
            .expect("missing mutations are not an error")
            .is_empty());
    }

    #[test]
    fn rebuilds_a_manifest_for_a_run_that_never_stopped() {
        let temp = TempDir::new("nostop");
        let root = write_bundle(&temp.path().join("run"), false);

        let trace = read_trace(&root).expect("bundle is readable");

        assert_eq!(trace.manifest.outcome, TraceOutcome::TRUNCATED);
        assert_eq!(trace.manifest.engine.as_deref(), Some("playwright"));
        assert_eq!(trace.manifest.mode.as_deref(), Some(TraceMode::CHECKPOINTS));
        assert_eq!(trace.manifest.counts.checkpoints, 1);
        assert_eq!(trace.manifest.events, vec!["console".to_string()]);
        assert!(trace.truncated);
        assert!(trace
            .html(1)
            .expect("html is readable")
            .expect("html was written")
            .contains("one"));
    }

    #[test]
    fn reads_a_timeline_whose_last_line_was_cut_off() {
        let temp = TempDir::new("cutoff");
        let root = write_bundle(&temp.path().join("run"), false);
        let events = root.join(TraceFiles::EVENTS);
        let body = format!(
            "{}{}",
            fs::read_to_string(&events).expect("timeline is readable"),
            "{\"kind\":\"console\",\"text\":\"half"
        );
        fs::write(&events, body).expect("timeline is writable");

        let trace = read_trace(&root).expect("bundle is readable");

        assert!(trace.truncated);
        assert_eq!(trace.events.len(), 2);
    }

    #[test]
    fn refuses_a_directory_that_holds_no_trace() {
        let temp = TempDir::new("empty");

        let error = read_trace(temp.path().join("nothing-here")).expect_err("no bundle");

        assert!(error.to_string().starts_with("no trace bundle at"));
    }

    #[test]
    fn refuses_a_manifest_that_is_not_readable_json() {
        let temp = TempDir::new("badjson");
        let root = write_bundle(&temp.path().join("run"), true);
        fs::write(root.join(TraceFiles::MANIFEST), "not json").expect("manifest is writable");

        let error = read_trace(&root).expect_err("manifest is unreadable");

        assert!(error.to_string().contains("is not readable JSON"));
    }

    #[test]
    fn refuses_a_bundle_written_by_a_newer_format() {
        let temp = TempDir::new("newer");
        let root = write_bundle(&temp.path().join("run"), true);
        fs::write(
            root.join(TraceFiles::MANIFEST),
            json!({"format": "browser-commander-trace", "schemaVersion": 99}).to_string(),
        )
        .expect("manifest is writable");

        let error = read_trace(&root).expect_err("format is too new");

        assert_eq!(
            error.to_string(),
            format!("trace schema version 99 is newer than this reader ({TRACE_SCHEMA_VERSION})")
        );
    }

    #[test]
    fn refuses_a_directory_that_holds_something_else() {
        let temp = TempDir::new("other");
        let root = write_bundle(&temp.path().join("run"), true);
        fs::write(
            root.join(TraceFiles::MANIFEST),
            json!({"format": "something-else"}).to_string(),
        )
        .expect("manifest is writable");

        let error = read_trace(&root).expect_err("not a trace");

        assert_eq!(error.to_string(), "not a Browser Commander trace bundle");
    }

    #[test]
    fn reports_what_a_step_changed_added_and_removed() {
        let before = json!({"controls": [
            {"path": "input#name", "value": "before"},
            {"path": "input#gone", "value": "x"},
            {"path": "input#same", "value": "stable"},
        ]});
        let after = json!({"controls": [
            {"path": "input#name", "value": "after"},
            {"path": "input#same", "value": "stable"},
            {"path": "input#new", "value": "fresh"},
        ]});

        let changes = diff_control_state(Some(&before), Some(&after));

        assert_eq!(
            changes,
            vec![
                ControlChange {
                    path: Some("input#name".to_string()),
                    change: ControlChangeKind::Changed,
                    before: Some(json!("before")),
                    after: Some(json!("after")),
                },
                ControlChange {
                    path: Some("input#new".to_string()),
                    change: ControlChangeKind::Added,
                    before: None,
                    after: Some(json!("fresh")),
                },
                ControlChange {
                    path: Some("input#gone".to_string()),
                    change: ControlChangeKind::Removed,
                    before: Some(json!("x")),
                    after: None,
                },
            ]
        );
    }

    #[test]
    fn reports_a_checkbox_by_what_it_is_checked_to() {
        let before = json!({"controls": [{"path": "input", "checked": false, "value": "on"}]});
        let after = json!({"controls": [{"path": "input", "checked": true, "value": "on"}]});

        let changes = diff_control_state(Some(&before), Some(&after));

        assert_eq!(
            changes,
            vec![ControlChange {
                path: Some("input".to_string()),
                change: ControlChangeKind::Changed,
                before: Some(json!(false)),
                after: Some(json!(true)),
            }]
        );
    }

    #[test]
    fn reads_a_missing_state_as_no_controls_at_all() {
        assert!(diff_control_state(None, None).is_empty());
    }

    /// Write a bundle holding the records schema 2 added (issue #93).
    ///
    /// The records are the ones `page-capture.js` builds in the page: a
    /// `live-state` entry for a control nothing in the DOM reflects, a
    /// `childList` entry carrying where each node went, and owner identifiers
    /// on every timeline record. A reader that only understood schema 1 would
    /// hand these back as unlabelled JSON, so this asserts what a caller can
    /// actually get at.
    fn write_continuous_bundle(root: &Path) -> PathBuf {
        write(
            &root.join(TraceFiles::CHECKPOINTS_DIR).join("0001.html"),
            "<html><body><ul id='list'><li>b</li></ul></body></html>",
        );
        write(
            &root
                .join(TraceFiles::CHECKPOINTS_DIR)
                .join("0001.state.json"),
            &json!({"url": "https://example.com/app", "controls": []}).to_string(),
        );
        write(
            &root.join(TraceFiles::MUTATIONS_DIR).join("0001.ndjson"),
            &ndjson(&[
                json!({
                    "sequence": 1,
                    "at": 1,
                    "url": "https://example.com/app",
                    "frameId": "frame-1",
                    "mainFrame": true,
                    "records": [{
                        "kind": TraceMutationKind::CHILD_LIST,
                        "target": {"path": "ul#list"},
                        "added": [{"path": "ul#list > li", "index": 0}],
                        "removed": [],
                        "previous": Value::Null,
                        "next": {"path": "ul#list > li"},
                    }],
                }),
                json!({
                    "sequence": 2,
                    "at": 2,
                    "url": "https://example.com/app",
                    "frameId": "frame-2",
                    "mainFrame": false,
                    "records": [{
                        "kind": TraceMutationKind::LIVE_STATE,
                        "property": TraceLiveState::VALUE,
                        "target": {"path": "input#name"},
                        "before": "",
                        "after": "ada",
                    }],
                }),
            ]),
        );
        write(
            &root.join(TraceFiles::EVENTS),
            &ndjson(&[
                json!({
                    "kind": TraceEvent::TRACE_START,
                    "sequence": 1,
                    "at": "2026-01-01T00:00:00.000Z",
                    "mode": TraceMode::CONTINUOUS,
                    "engine": "playwright",
                    "events": ["navigation"],
                    "traceId": "trace-1",
                    "browserContextId": "context-1",
                    "pageId": "page-1",
                    "navigationId": "nav-1",
                }),
                json!({
                    "kind": TraceEvent::CHECKPOINT,
                    "sequence": 2,
                    "at": "2026-01-01T00:00:01.000Z",
                    "index": 1,
                    "name": "initial",
                    "actor": "automation",
                    "reason": TraceCheckpointReason::INITIAL,
                    "url": "https://example.com/app",
                    "traceId": "trace-1",
                    "browserContextId": "context-1",
                    "pageId": "page-1",
                    "navigationId": "nav-1",
                    "members": {
                        "html": "checkpoints/0001.html",
                        "state": "checkpoints/0001.state.json",
                    },
                }),
            ]),
        );
        write(
            &root.join(TraceFiles::MANIFEST),
            &json!({
                "schemaVersion": TRACE_SCHEMA_VERSION,
                "format": super::super::schema::TRACE_FORMAT,
                "mode": TraceMode::CONTINUOUS,
                "outcome": TraceOutcome::COMPLETE,
                "engine": "playwright",
                "replay": {
                    "checkpoints": true,
                    "mutations": true,
                    "childListPositions": true,
                    "liveState": true,
                    "identifiers": true,
                },
                "counts": {"checkpoints": 1, "events": 2, "mutationBatches": 2},
            })
            .to_string(),
        );

        root.to_path_buf()
    }

    #[test]
    fn reads_a_child_list_record_with_the_position_a_node_went_to() {
        let dir = TempDir::new("trace-continuous-child-list");
        let trace = read_trace(write_continuous_bundle(dir.path())).expect("bundle reads");

        let batches = trace.mutations(1).expect("mutations read");
        assert_eq!(batches.len(), 2);
        let record = &batches[0]["records"][0];
        assert_eq!(record["kind"], TraceMutationKind::CHILD_LIST);
        // Appending would put the new item after the existing one; index 0 is
        // the difference between replaying the insertion and guessing at it.
        assert_eq!(record["added"][0]["index"], 0);
        assert_eq!(record["next"]["path"], "ul#list > li");
    }

    #[test]
    fn reads_a_live_state_record_no_mutation_would_report() {
        let dir = TempDir::new("trace-continuous-live-state");
        let trace = read_trace(write_continuous_bundle(dir.path())).expect("bundle reads");

        let record = &trace.mutations(1).expect("mutations read")[1]["records"][0];
        assert_eq!(record["kind"], TraceMutationKind::LIVE_STATE);
        assert_eq!(record["property"], TraceLiveState::VALUE);
        assert_eq!(record["before"], "");
        assert_eq!(record["after"], "ada");
    }

    #[test]
    fn keeps_the_frame_each_batch_came_from() {
        let dir = TempDir::new("trace-continuous-frames");
        let trace = read_trace(write_continuous_bundle(dir.path())).expect("bundle reads");

        let frames: Vec<String> = trace
            .mutations(1)
            .expect("mutations read")
            .iter()
            .map(|batch| batch["frameId"].as_str().unwrap_or_default().to_string())
            .collect();
        assert_eq!(frames, vec!["frame-1", "frame-2"]);
    }

    #[test]
    fn keeps_the_owner_identifiers_on_every_record() {
        let dir = TempDir::new("trace-continuous-identity");
        let trace = read_trace(write_continuous_bundle(dir.path())).expect("bundle reads");

        for event in &trace.events {
            assert_eq!(event["traceId"], "trace-1");
            assert_eq!(event["browserContextId"], "context-1");
            assert_eq!(event["pageId"], "page-1");
            assert_eq!(event["navigationId"], "nav-1");
        }
    }

    #[test]
    fn reports_what_the_bundle_can_replay_rather_than_assuming() {
        let dir = TempDir::new("trace-continuous-replay");
        let trace = read_trace(write_continuous_bundle(dir.path())).expect("bundle reads");

        assert!(trace.manifest.replay.mutations);
        assert!(trace.manifest.replay.child_list_positions);
        assert!(trace.manifest.replay.live_state);
        assert!(trace.manifest.replay.identifiers);
        assert_eq!(
            trace.checkpoints[0].reason.as_deref(),
            Some(TraceCheckpointReason::INITIAL)
        );
    }
}
