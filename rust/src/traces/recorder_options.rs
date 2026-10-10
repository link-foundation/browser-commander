//! What a caller tells the trace recorder, and what it gets back (issue #108).
//!
//! The options of `startTrace()`, `trace.checkpoint()` and `trace.stop()` in
//! `js/src/traces/recorder.js`, typed; [`super::recorder`] reads them.

use std::path::PathBuf;

use super::bundle::{TraceClock, TraceLimits, TraceProblem};
use super::jsonfmt::JsonObject;
use super::links::TraceLinksOptions;
use super::redaction::TracePrivacyOptions;
use super::schema::TraceMode;

/// How long one capture may take before it is dropped, in milliseconds.
pub const DEFAULT_CAPTURE_TIMEOUT_MS: u64 = 15_000;

/// When a checkpoint takes a screenshot.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TraceScreenshots {
    /// Never (`screenshots: false`).
    Off,
    /// At every checkpoint (`'checkpoints'` or `true`), the default.
    #[default]
    Checkpoints,
    /// Only at a checkpoint whose reason is `failure`.
    OnlyOnFailure,
}

/// Whether a trace starts with a checkpoint of the page as it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TraceInitialCheckpoint {
    /// No base checkpoint.
    Skip,
    /// A base checkpoint named `initial`.
    Take,
    /// A base checkpoint with this name.
    Named(String),
}

/// What a checkpoint captures of the DOM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraceDomOptions {
    /// Keep the serialized HTML.
    pub html: bool,
    /// Keep form control values at checkpoints.
    pub live_control_state: bool,
    /// Record typing, checking, selecting, focus and scroll as they happen.
    pub live_state: bool,
    /// Record DOM mutations between checkpoints; `None` turns them on for a
    /// continuous trace only.
    pub mutations: Option<bool>,
    /// Descend into open shadow roots.
    pub open_shadow_roots: bool,
}

impl Default for TraceDomOptions {
    fn default() -> Self {
        Self {
            html: true,
            live_control_state: true,
            live_state: true,
            mutations: None,
            open_shadow_roots: true,
        }
    }
}

/// Options for [`start_trace`](super::start_trace), `startTrace()` in JavaScript.
#[derive(Clone)]
pub struct TraceOptions {
    /// The bundle directory.
    pub output: PathBuf,
    /// One of [`TraceMode`]; `checkpoints` unless set.
    pub mode: String,
    /// `None` takes a base checkpoint in continuous mode only.
    pub initial_checkpoint: Option<TraceInitialCheckpoint>,
    /// When checkpoints take screenshots.
    pub screenshots: TraceScreenshots,
    /// What checkpoints capture.
    pub dom: TraceDomOptions,
    /// Omit these selectors and their descendants from snapshots and mutations.
    pub ignore_selectors: Vec<String>,
    /// Event sources to record, from [`TRACE_EVENT_SOURCES`](super::TRACE_EVENT_SOURCES); `None` records
    /// all of them and an empty list none.
    pub events: Option<Vec<String>>,
    /// What is redacted before anything is written.
    pub privacy: TracePrivacyOptions,
    /// Size ceilings.
    pub limits: TraceLimits,
    /// Also write a Links Notation export as the trace records.
    pub links: Option<TraceLinksOptions>,
    /// Fail instead of recording a `dropped` event.
    pub strict: bool,
    /// Gzip closed timeline and mutation members.
    pub gzip: bool,
    /// Opt-in network metadata, bounded bodies and HAR.
    pub network: Option<super::network::NetworkTraceOptions>,
    /// Bounded optional session recording embedded in the bundle.
    pub video: Option<crate::capture::RecordingOptions>,
    /// Checkpoint after a main-frame navigation.
    pub checkpoint_on_navigation: bool,
    /// Budget for one capture in milliseconds; `0` means none.
    pub capture_timeout_ms: u64,
    /// Written to the manifest; this crate's version unless set.
    pub commander_version: Option<String>,
    /// Written to the manifest; the page's engine unless set.
    pub engine: Option<String>,
    /// Where timestamps come from.
    pub clock: TraceClock,
}

impl TraceOptions {
    /// Continuous DOM text, network/HAR and navigation checkpoints in one configuration.
    pub fn debug(output: impl Into<PathBuf>) -> Self {
        let mut options = Self::new(output);
        options.mode = "continuous".into();
        options.links = Some(super::links::TraceLinksOptions {
            output: options.output.join("trace.lino"),
            include: None,
            dom: Some("text".into()),
        });
        options.network = Some(super::network::NetworkTraceOptions {
            har: true,
            ..Default::default()
        });
        options.checkpoint_on_navigation = true;
        options
    }
    /// Options that record into `output`, with every default.
    pub fn new(output: impl Into<PathBuf>) -> Self {
        Self {
            output: output.into(),
            mode: TraceMode::CHECKPOINTS.to_string(),
            initial_checkpoint: None,
            screenshots: TraceScreenshots::default(),
            dom: TraceDomOptions::default(),
            ignore_selectors: Vec::new(),
            events: None,
            privacy: TracePrivacyOptions::default(),
            limits: TraceLimits::default(),
            links: None,
            strict: false,
            gzip: false,
            network: None,
            video: None,
            checkpoint_on_navigation: false,
            capture_timeout_ms: DEFAULT_CAPTURE_TIMEOUT_MS,
            commander_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            engine: None,
            clock: TraceClock::default(),
        }
    }
}

/// Who took a checkpoint and why.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TraceCheckpointOptions {
    /// `automation` unless set.
    pub actor: Option<String>,
    /// One of [`TraceCheckpointReason`](super::TraceCheckpointReason); `checkpoint` unless set.
    pub reason: Option<String>,
}

/// The error a run ended with, recorded as a fatal `pageerror`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceFailure {
    /// The error message.
    pub message: String,
    /// A stack or backtrace, when there is one.
    pub stack: Option<String>,
}

impl TraceFailure {
    /// A failure with this message and no stack.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            stack: None,
        }
    }
}

/// How a trace is stopped.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TraceStopOptions {
    /// Delete the bundle and the export once they are finished.
    pub discard: bool,
    /// The error the run ended with.
    pub error: Option<TraceFailure>,
}

/// What [`TraceRecorder::stop`](super::TraceRecorder::stop) returns.
#[derive(Debug, Clone, PartialEq)]
pub struct TraceResult {
    /// The bundle directory.
    pub path: PathBuf,
    /// The manifest as written.
    pub manifest: JsonObject,
    /// One entry per checkpoint, as recorded on the timeline.
    pub checkpoints: Vec<JsonObject>,
    /// What the bundle and the export could not record.
    pub problems: Vec<TraceProblem>,
    /// The Links Notation export, when one was written.
    pub links: Option<PathBuf>,
    /// Whether the bundle was deleted.
    pub discarded: bool,
}
