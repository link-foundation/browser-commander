//! The portable browser trace format, as Rust knows it (issue #87).
//!
//! A trace is written by the JavaScript recorder and read by JavaScript,
//! Python and Rust. The layout is the contract between them, so every name and
//! value a reader has to agree on lives here, mirroring
//! `js/src/traces/schema.js`.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Schema version of the bundle.
///
/// Readers refuse a major version they were not written for rather than
/// guessing at the meaning of unknown records.
pub const TRACE_SCHEMA_VERSION: u64 = 1;

/// Value of `manifest.json`'s `format` field, for every version.
pub const TRACE_FORMAT: &str = "browser-commander-trace";

/// Event families a caller can subscribe the recorder to.
pub const TRACE_EVENT_SOURCES: [&str; 7] = [
    "navigation",
    "interaction",
    "console",
    "pageerror",
    "dialog",
    "requestfailed",
    "download",
];

/// Names every reader looks for inside a bundle.
pub struct TraceFiles;

impl TraceFiles {
    /// What the run was and how it ended.
    pub const MANIFEST: &'static str = "manifest.json";
    /// The one ordered timeline.
    pub const EVENTS: &'static str = "events.ndjson";
    /// Per-checkpoint HTML, control state and screenshots.
    pub const CHECKPOINTS_DIR: &'static str = "checkpoints";
    /// DOM mutation batches, one file per checkpoint interval.
    pub const MUTATIONS_DIR: &'static str = "mutations";
    /// Content-addressed resources the timeline refers to.
    pub const ARTIFACTS_DIR: &'static str = "artifacts";
    /// The offline viewer, when one was written.
    pub const VIEWER: &'static str = "viewer.html";
}

/// What the recorder captures.
pub struct TraceMode;

impl TraceMode {
    /// Nothing is recorded.
    pub const OFF: &'static str = "off";
    /// Only the moments a caller asks for.
    pub const CHECKPOINTS: &'static str = "checkpoints";
    /// Checkpoints plus every DOM change between them.
    pub const CONTINUOUS: &'static str = "continuous";
    /// Record continuously, keep the bundle only when the run fails.
    pub const RETAIN_ON_FAILURE: &'static str = "retain-on-failure";
}

/// Event kinds that share the one ordered timeline.
pub struct TraceEvent;

impl TraceEvent {
    /// The recorder started.
    pub const TRACE_START: &'static str = "trace.start";
    /// The recorder stopped.
    pub const TRACE_STOP: &'static str = "trace.stop";
    /// A named moment was captured.
    pub const CHECKPOINT: &'static str = "checkpoint";
    /// A batch of DOM mutations was written.
    pub const MUTATIONS: &'static str = "mutations";
    /// The page went somewhere.
    pub const NAVIGATION: &'static str = "navigation";
    /// Browser Commander drove the page.
    pub const INTERACTION: &'static str = "interaction";
    /// The page logged something.
    pub const CONSOLE: &'static str = "console";
    /// The page threw.
    pub const PAGE_ERROR: &'static str = "pageerror";
    /// The page asked the user something.
    pub const DIALOG: &'static str = "dialog";
    /// A request never reached a server.
    pub const REQUEST_FAILED: &'static str = "requestfailed";
    /// A download started, finished or failed.
    pub const DOWNLOAD: &'static str = "download";
    /// Something could not be recorded. The run continues; the gap is visible.
    pub const DROPPED: &'static str = "dropped";
}

/// Why a record was dropped.
pub struct TraceDropReason;

impl TraceDropReason {
    /// The record was larger than a configured ceiling.
    pub const SIZE_LIMIT: &'static str = "size-limit";
    /// The bytes could not be written.
    pub const WRITE_FAILED: &'static str = "write-failed";
    /// The page could not produce the record.
    pub const CAPTURE_FAILED: &'static str = "capture-failed";
    /// The page was gone before the record was taken.
    pub const PAGE_CLOSED: &'static str = "page-closed";
    /// The capture took longer than it was allowed to.
    pub const TIMEOUT: &'static str = "timeout";
}

/// How a trace ended, recorded in the manifest.
pub struct TraceOutcome;

impl TraceOutcome {
    /// `stop()` was called and every record was written.
    pub const COMPLETE: &'static str = "complete";
    /// The trace is readable but records are missing.
    pub const PARTIAL: &'static str = "partial";
    /// No manifest was ever written; readers repair this on open.
    pub const TRUNCATED: &'static str = "truncated";
}

/// How many members of each kind a bundle holds.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceCounts {
    /// Named moments captured.
    #[serde(default)]
    pub checkpoints: u64,
    /// Records on the timeline.
    #[serde(default)]
    pub events: u64,
    /// DOM mutation batches written.
    #[serde(default)]
    pub mutation_batches: u64,
}

/// What a bundle says about the run that produced it.
///
/// Unknown fields are kept rather than dropped, so a bundle written by a newer
/// minor version of the format survives a round trip through this reader.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TraceManifest {
    /// Version of the layout the bundle was written against.
    #[serde(default)]
    pub schema_version: u64,
    /// Always [`TRACE_FORMAT`] for a Browser Commander trace.
    #[serde(default)]
    pub format: String,
    /// One of [`TraceMode`].
    #[serde(default)]
    pub mode: Option<String>,
    /// One of [`TraceOutcome`].
    #[serde(default = "complete_outcome")]
    pub outcome: String,
    /// When the recorder started.
    #[serde(default)]
    pub started_at: Option<String>,
    /// When the recorder stopped.
    #[serde(default)]
    pub stopped_at: Option<String>,
    /// Version of the library that recorded the run.
    #[serde(default)]
    pub commander_version: Option<String>,
    /// Engine the run drove.
    #[serde(default)]
    pub engine: Option<String>,
    /// Browser name and version.
    #[serde(default)]
    pub browser: Option<String>,
    /// Operating system the run happened on.
    #[serde(default)]
    pub platform: Option<String>,
    /// Language runtime that recorded the run.
    #[serde(default)]
    pub runtime: Option<String>,
    /// Event families the recorder subscribed to.
    #[serde(default)]
    pub events: Vec<String>,
    /// DOM capture settings the recorder applied.
    #[serde(default)]
    pub dom: Map<String, Value>,
    /// Redaction settings the recorder applied.
    #[serde(default)]
    pub privacy: Map<String, Value>,
    /// Size ceilings the recorder applied.
    #[serde(default)]
    pub limits: Map<String, Value>,
    /// Members written, by kind.
    #[serde(default)]
    pub counts: TraceCounts,
    /// How many records could not be written.
    #[serde(default)]
    pub dropped: u64,
    /// Anything a newer writer added that this reader does not name.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

fn complete_outcome() -> String {
    TraceOutcome::COMPLETE.to_string()
}

impl Default for TraceManifest {
    fn default() -> Self {
        Self {
            schema_version: TRACE_SCHEMA_VERSION,
            format: TRACE_FORMAT.to_string(),
            mode: None,
            outcome: complete_outcome(),
            started_at: None,
            stopped_at: None,
            commander_version: None,
            engine: None,
            browser: None,
            platform: Some(format!(
                "{} {}",
                std::env::consts::OS,
                std::env::consts::ARCH
            )),
            runtime: Some(format!("rust {}", env!("CARGO_PKG_VERSION"))),
            events: Vec::new(),
            dom: Map::new(),
            privacy: Map::new(),
            limits: Map::new(),
            counts: TraceCounts::default(),
            dropped: 0,
            extra: Map::new(),
        }
    }
}

impl TraceManifest {
    /// Whether the bundle holds everything the run produced.
    pub fn is_complete(&self) -> bool {
        self.outcome == TraceOutcome::COMPLETE
    }
}

/// Format a bundle member's sequence number.
///
/// Zero padding keeps `ls` and any reader that sorts lexically in the same
/// order as the sequence itself.
pub fn sequence_name(index: u32) -> String {
    format!("{index:04}")
}

/// Check that a manifest can be read by this version of the format.
///
/// # Errors
///
/// Returns an error when the bundle is not a trace, or was written against a
/// newer schema version than this reader knows.
pub fn assert_readable_manifest(manifest: &TraceManifest) -> Result<(), crate::traces::TraceError> {
    if manifest.format != TRACE_FORMAT {
        return Err(crate::traces::TraceError::NotATrace);
    }
    if manifest.schema_version > TRACE_SCHEMA_VERSION {
        return Err(crate::traces::TraceError::UnsupportedVersion {
            found: manifest.schema_version,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(format: &str, schema_version: u64) -> TraceManifest {
        TraceManifest {
            format: format.to_string(),
            schema_version,
            ..TraceManifest::default()
        }
    }

    #[test]
    fn pads_a_sequence_number_so_it_sorts_in_order() {
        assert_eq!(sequence_name(1), "0001");
        assert_eq!(sequence_name(42), "0042");
        // Beyond four digits the number wins over the padding; the bundle
        // stays readable, the ordering is the caller's problem.
        assert_eq!(sequence_name(10_000), "10000");
    }

    #[test]
    fn accepts_a_manifest_this_reader_was_written_for() {
        assert!(assert_readable_manifest(&manifest(TRACE_FORMAT, TRACE_SCHEMA_VERSION)).is_ok());
    }

    #[test]
    fn refuses_something_that_is_not_a_trace() {
        let error = assert_readable_manifest(&manifest("something-else", 1))
            .expect_err("format does not match");

        assert_eq!(error.to_string(), "not a Browser Commander trace bundle");
    }

    #[test]
    fn refuses_a_newer_schema_rather_than_guessing() {
        let error = assert_readable_manifest(&manifest(TRACE_FORMAT, TRACE_SCHEMA_VERSION + 1))
            .expect_err("schema is too new");

        assert!(error.to_string().contains("newer than this reader"));
    }

    #[test]
    fn declares_the_same_schema_version_as_javascript() {
        // The three halves of the format are kept in step by hand, so check.
        let source =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../js/src/traces/schema.js");
        let Ok(body) = std::fs::read_to_string(&source) else {
            // Published crates carry no JavaScript package to compare against.
            return;
        };

        assert!(body.contains(&format!("TRACE_SCHEMA_VERSION = {TRACE_SCHEMA_VERSION};")));
        assert!(body.contains(&format!("format: '{TRACE_FORMAT}'")));
    }
}
