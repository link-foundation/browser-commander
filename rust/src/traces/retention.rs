//! Keep a run's trace only when the run failed (issue #108).
//!
//! JavaScript decides this in its test runner (`js/src/tests/tracing.js`):
//! `trace: 'retain-on-failure'` records every attempt, and a passing attempt's
//! bundle is removed when it stops. Python offers the same decision as the
//! `traced()` context manager. Rust has no runner of its own either, so
//! [`record_scenario`] wraps the work a caller wants explained:
//!
//! ```rust,no_run
//! use std::sync::Arc;
//!
//! use browser_commander::traces::{record_scenario, scenario_trace_options, TracePage};
//!
//! # async fn run(page: Arc<dyn TracePage>) -> Result<(), Box<dyn std::error::Error>> {
//! let run = record_scenario(
//!     page,
//!     "retain-on-failure",
//!     1,
//!     scenario_trace_options("artifacts/login.bc-trace"),
//!     |_recorder| async { Ok::<_, std::io::Error>(()) },
//! )
//! .await?;
//! // A passing run leaves no bundle; a failing one leaves it with its viewer.
//! if let Some(trace) = run.trace? {
//!     assert!(trace.discarded);
//! }
//! run.outcome?;
//! # Ok(())
//! # }
//! ```
//!
//! The settings use the JavaScript runner's vocabulary, which is Playwright's,
//! and a kept bundle gets the offline viewer written next to it.

use std::fmt::Display;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::bundle::{TraceProblem, TraceRecordError};
use super::page::TracePage;
use super::recorder::{
    start_trace, TraceCheckpointOptions, TraceFailure, TraceOptions, TraceRecorder, TraceResult,
    TraceScreenshots, TraceStopOptions,
};
use super::schema::{TraceCheckpointReason, TraceMode};
use super::viewer::write_trace_viewer;

/// Trace settings a run may ask for, in Playwright's vocabulary.
pub const TEST_TRACE_MODES: [&str; 4] = ["off", "on", "retain-on-failure", "on-first-retry"];

/// Suffix that marks a trace bundle directory.
pub const TRACE_BUNDLE_SUFFIX: &str = ".bc-trace";

/// How one attempt records, when it records at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraceSetting {
    /// The [`TraceMode`] the recorder runs in.
    pub recorder_mode: &'static str,
    /// Whether a passing attempt's bundle is discarded.
    pub retain_on_failure: bool,
}

/// Decide whether this attempt records, and in which recorder mode.
///
/// `attempt` is 1 for the first run and 2 for the first retry.
///
/// # Errors
///
/// Fails for a setting outside [`TEST_TRACE_MODES`].
pub fn resolve_trace_setting(
    trace: &str,
    attempt: u32,
) -> Result<Option<TraceSetting>, TraceRecordError> {
    if !TEST_TRACE_MODES.contains(&trace) {
        return Err(TraceRecordError::Invalid(format!(
            "trace must be one of {}",
            TEST_TRACE_MODES.join(", ")
        )));
    }
    if trace == "off" || (trace == "on-first-retry" && attempt < 2) {
        return Ok(None);
    }
    Ok(Some(TraceSetting {
        recorder_mode: if trace == "on" {
            TraceMode::CONTINUOUS
        } else {
            TraceMode::RETAIN_ON_FAILURE
        },
        retain_on_failure: trace != "on",
    }))
}

/// Where one attempt's trace bundle lives.
pub fn trace_output_path(
    artifacts_dir: impl AsRef<Path>,
    safe_name: &str,
    attempt: u32,
) -> PathBuf {
    let suffix = if attempt > 1 {
        format!(".attempt-{attempt}")
    } else {
        String::new()
    };
    artifacts_dir
        .as_ref()
        .join(format!("{safe_name}{suffix}{TRACE_BUNDLE_SUFFIX}"))
}

/// The options a run is recorded with unless the caller changes them.
///
/// A run that fails halfway is exactly where ordered DOM mutations pay for
/// themselves, so they are on; screenshots are taken only at the failure.
pub fn scenario_trace_options(output: impl Into<PathBuf>) -> TraceOptions {
    let mut options = TraceOptions::new(output);
    options.dom.mutations = Some(true);
    options.screenshots = TraceScreenshots::OnlyOnFailure;
    options
}

/// A running attempt's trace.
#[derive(Debug, Clone)]
pub struct ScenarioTrace {
    /// The recorder.
    pub recorder: TraceRecorder,
    /// Whether a passing attempt's bundle is discarded.
    pub retain_on_failure: bool,
}

/// Start a trace for one attempt; `None` when this attempt does not record.
///
/// `options.mode` is replaced by the mode `trace` asks for.
///
/// # Errors
///
/// Fails for an unknown `trace` setting, or when the trace cannot start.
pub async fn start_scenario_trace(
    page: Arc<dyn TracePage>,
    trace: &str,
    attempt: u32,
    mut options: TraceOptions,
) -> Result<Option<ScenarioTrace>, TraceRecordError> {
    let Some(setting) = resolve_trace_setting(trace, attempt)? else {
        return Ok(None);
    };
    options.mode = setting.recorder_mode.to_string();
    let recorder = start_trace(page, options).await?;
    Ok(Some(ScenarioTrace {
        recorder,
        retain_on_failure: setting.retain_on_failure,
    }))
}

/// Stop an attempt's trace, keeping it only when it is worth keeping.
///
/// It ends with a `failure` checkpoint when `error` is set and a `final` one
/// otherwise. A kept bundle gets the offline viewer; a problem writing either
/// is listed in the result rather than raised.
///
/// # Errors
///
/// Fails when the trace cannot be stopped.
pub async fn finish_scenario_trace(
    started: Option<ScenarioTrace>,
    error: Option<TraceFailure>,
) -> Result<Option<TraceResult>, TraceRecordError> {
    let Some(started) = started else {
        return Ok(None);
    };
    let reason = if error.is_some() {
        TraceCheckpointReason::FAILURE
    } else {
        "final"
    };
    let checkpoint = started
        .recorder
        .checkpoint_with(
            reason,
            TraceCheckpointOptions {
                actor: Some("runner".to_string()),
                reason: Some(reason.to_string()),
            },
        )
        .await;

    let discard = started.retain_on_failure && error.is_none();
    let mut stopped = started
        .recorder
        .stop_with(TraceStopOptions { discard, error })
        .await?;
    if let Err(checkpoint_error) = checkpoint {
        stopped.problems.push(problem(format!(
            "could not capture the {reason} checkpoint: {checkpoint_error}"
        )));
    }
    if !discard {
        if let Err(viewer_error) = write_trace_viewer(&stopped.path) {
            stopped.problems.push(problem(format!(
                "could not write the viewer: {viewer_error}"
            )));
        }
    }
    Ok(Some(stopped))
}

fn problem(detail: String) -> TraceProblem {
    TraceProblem {
        reason: None,
        member: None,
        detail: Some(detail),
    }
}

/// What [`record_scenario`] ran and recorded.
#[derive(Debug)]
pub struct ScenarioRun<T, E> {
    /// The work's own result, unchanged.
    pub outcome: Result<T, E>,
    /// The stopped trace (discarded or kept), `None` when the attempt did not
    /// record, or the error stopping it.
    pub trace: Result<Option<TraceResult>, TraceRecordError>,
}

/// Record `work`, keeping the trace as the `trace` setting asks.
///
/// With `retain-on-failure` a failing `work` leaves a bundle (ending in a
/// `failure` checkpoint, with its error recorded and the offline viewer
/// written) and a passing one leaves nothing. `work` receives the recorder,
/// or `None` when this attempt does not record, and its result is returned
/// unchanged, as is the outcome of stopping the trace.
///
/// # Errors
///
/// Fails, without running `work`, for an unknown `trace` setting or when the
/// trace cannot start.
pub async fn record_scenario<T, E, F, Fut>(
    page: Arc<dyn TracePage>,
    trace: &str,
    attempt: u32,
    options: TraceOptions,
    work: F,
) -> Result<ScenarioRun<T, E>, TraceRecordError>
where
    E: Display,
    F: FnOnce(Option<TraceRecorder>) -> Fut,
    Fut: Future<Output = Result<T, E>>,
{
    let started = start_scenario_trace(page, trace, attempt, options).await?;
    let outcome = work(started.as_ref().map(|started| started.recorder.clone())).await;
    let error = outcome
        .as_ref()
        .err()
        .map(|error| TraceFailure::new(error.to_string()));
    let trace = finish_scenario_trace(started, error).await;
    Ok(ScenarioRun { outcome, trace })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_settings_like_the_javascript_runner() {
        assert_eq!(resolve_trace_setting("off", 1).unwrap(), None);
        assert_eq!(resolve_trace_setting("on-first-retry", 1).unwrap(), None);
        assert_eq!(
            resolve_trace_setting("on-first-retry", 2).unwrap(),
            Some(TraceSetting {
                recorder_mode: TraceMode::RETAIN_ON_FAILURE,
                retain_on_failure: true,
            })
        );
        assert_eq!(
            resolve_trace_setting("on", 1).unwrap(),
            Some(TraceSetting {
                recorder_mode: TraceMode::CONTINUOUS,
                retain_on_failure: false,
            })
        );
        assert!(resolve_trace_setting("sometimes", 1).is_err());
    }

    #[test]
    fn names_retries_apart() {
        assert_eq!(
            trace_output_path("out", "login", 1),
            Path::new("out").join("login.bc-trace")
        );
        assert_eq!(
            trace_output_path("out", "login", 2),
            Path::new("out").join("login.attempt-2.bc-trace")
        );
    }
}
