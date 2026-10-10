//! Privacy-aware portable traces (issue #87).
//!
//! A trace is one versioned directory holding a manifest, an ordered timeline,
//! per-checkpoint DOM snapshots and the mutation batches between them.
//!
//! Rust records traces natively (issue #108): [`start_trace`] writes the same
//! bundle JavaScript writes, record for record, [`write_trace_viewer`] adds the
//! same offline viewer, and [`TraceOptions::links`] streams the same Links
//! Notation export. [`record_scenario`] keeps a bundle only when the work it
//! wraps fails, as `retain-on-failure` does in the JavaScript test runner.
//! Every in-page function comes from the shared `assets.json`,
//! so the page runs the very code JavaScript runs. Rust reads traces too. See
//! `docs/feature-parity.md` for the current state of each language.
//!
//! # Example
//!
//! ```rust,no_run
//! use std::sync::Arc;
//!
//! use browser_commander::core::EngineAdapter;
//! use browser_commander::traces::{
//!     read_trace, start_trace, write_trace_viewer, AdapterTracePage, TraceLinksOptions,
//!     TraceOptions,
//! };
//!
//! # async fn run(page: Arc<dyn EngineAdapter>) -> Result<(), Box<dyn std::error::Error>> {
//! let mut options = TraceOptions::new("./traces/run");
//! options.mode = "continuous".into();
//! options.links = Some(TraceLinksOptions {
//!     output: "./traces/run.lino".into(),
//!     include: None,
//!     dom: None,
//! });
//! let recorder = start_trace(Arc::new(AdapterTracePage::new(page)), options).await?;
//! recorder.checkpoint("after-login").await?;
//! let result = recorder.stop().await?;
//! write_trace_viewer(&result.path)?;
//!
//! let trace = read_trace(&result.path)?;
//! for checkpoint in &trace.checkpoints {
//!     println!("{:?}", checkpoint.name);
//! }
//! # Ok(())
//! # }
//! ```

pub mod assets;
pub mod bundle;
mod dom_links;
pub mod identity;
pub mod jsonfmt;
pub mod links;
pub mod mutation_stream;
pub mod network;
pub mod page;
mod raw_reader;
pub mod reader;
pub mod recorder;
pub mod rolling;
mod storage;
pub use rolling::{start_rolling_trace, RollingTraceRecorder, RotationOptions};
mod recorder_options;
pub mod redaction;
pub mod retention;
pub mod schema;
pub mod viewer;

pub use reader::{
    diff_control_state, parse_ndjson, read_trace, ControlChange, ControlChangeKind, ParsedNdjson,
    Trace, TraceCheckpoint, TraceError,
};
pub use schema::{
    assert_readable_manifest, sequence_name, TraceCheckpointReason, TraceCounts, TraceDropReason,
    TraceEvent, TraceFiles, TraceLiveState, TraceManifest, TraceMode, TraceMutationKind,
    TraceOutcome, TraceReplaySupport, TRACE_EVENT_SOURCES, TRACE_FORMAT, TRACE_SCHEMA_VERSION,
};

pub use bundle::{iso_timestamp, TraceClock, TraceLimits, TraceProblem, TraceRecordError};
pub use identity::reset_trace_identity_counters;
pub use jsonfmt::{Json, JsonObject};
pub use links::{trace_links, write_trace_links, TraceExportError, TraceLinksOptions};
pub use page::{AdapterTracePage, TracePage};
pub use recorder::{
    start_trace, TraceCheckpointOptions, TraceDomOptions, TraceFailure, TraceInitialCheckpoint,
    TraceOptions, TraceRecorder, TraceResult, TraceScreenshots, TraceStopOptions,
    DEFAULT_CAPTURE_TIMEOUT_MS,
};
pub use redaction::{
    normalize_privacy_options, redact_url, redact_value, NormalizedPrivacy, RedactCallback,
    RedactContext, TracePrivacyOptions, REDACTED,
};
pub use retention::{
    finish_scenario_trace, record_scenario, resolve_trace_setting, scenario_trace_options,
    start_scenario_trace, trace_output_path, ScenarioRun, ScenarioTrace, TraceSetting,
    TEST_TRACE_MODES, TRACE_BUNDLE_SUFFIX,
};
pub use viewer::{render_trace_viewer, write_trace_viewer, DEFAULT_MAX_INLINE_BYTES};
