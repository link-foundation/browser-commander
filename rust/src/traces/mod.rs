//! Privacy-aware portable traces (issue #87).
//!
//! A trace is one versioned directory holding a manifest, an ordered timeline,
//! per-checkpoint DOM snapshots and the mutation batches between them. The
//! JavaScript package records it; JavaScript, Python and Rust all read it.
//!
//! Rust reads traces and does not record them. See `docs/feature-parity.md`
//! for the current state of each language.
//!
//! # Example
//!
//! ```rust,no_run
//! use browser_commander::traces::read_trace;
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! let trace = read_trace("./traces/run")?;
//! for checkpoint in &trace.checkpoints {
//!     println!("{:?}", checkpoint.name);
//! }
//! # Ok(())
//! # }
//! ```

pub mod reader;
pub mod schema;

pub use reader::{
    diff_control_state, parse_ndjson, read_trace, ControlChange, ControlChangeKind, ParsedNdjson,
    Trace, TraceCheckpoint, TraceError,
};
pub use schema::{
    assert_readable_manifest, sequence_name, TraceCheckpointReason, TraceCounts, TraceDropReason,
    TraceEvent, TraceFiles, TraceLiveState, TraceManifest, TraceMode, TraceMutationKind,
    TraceOutcome, TraceReplaySupport, TRACE_EVENT_SOURCES, TRACE_FORMAT, TRACE_SCHEMA_VERSION,
};
