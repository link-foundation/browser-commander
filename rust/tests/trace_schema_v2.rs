//! Can Rust read what the JavaScript recorder now writes? (issues #93, #95)
//!
//! Schema 2 added the records a continuous replay needs: the position a node
//! was inserted at, the live state no mutation observer reports, the frame a
//! batch came from, the identifiers that say which run a record belongs to,
//! and a manifest block stating what the bundle can actually replay. Matching
//! the schema *version* would prove nothing on its own, so this reads a
//! hand-written schema 2 bundle through the crate's public API and asserts on
//! the records themselves.
//!
//! The bundle is the bytes the JavaScript recorder emits. A change on either
//! side that breaks the agreement fails here.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use browser_commander::traces::{
    read_trace, TraceCheckpointReason, TraceEvent, TraceFiles, TraceLiveState, TraceMode,
    TraceMutationKind, TraceOutcome, TRACE_FORMAT, TRACE_SCHEMA_VERSION,
};

/// A directory that removes itself, so a failing test leaves no litter.
///
/// The crate has no `tempfile` dev-dependency, and these tests are not a
/// reason to add one.
struct TempDir(PathBuf);

impl TempDir {
    fn new(name: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock is after the epoch")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("bc-trace-{name}-{}-{nanos}", std::process::id()));
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
            "format": TRACE_FORMAT,
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
