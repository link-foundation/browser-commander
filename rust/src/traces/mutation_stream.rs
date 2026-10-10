//! The continuous half of a trace (issue #93), in Rust (issue #108).
//!
//! `js/src/traces/mutation-stream.js` with the same in-page recorder: it is
//! installed into the document that exists and registered as an init script for
//! every document that follows, and each checkpoint drains what it queued. This
//! module holds the page side; the recorder writes what it returns.

use std::cmp::Ordering;

use super::assets::trace_assets;
use super::jsonfmt::{Json, JsonObject};
use super::page::{with_deadline, TracePage};

/// In-page records kept before the recorder starts counting drops instead.
pub const DEFAULT_MAX_QUEUED_MUTATIONS: u64 = 5000;

/// What one drain found.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Drained {
    /// Every batch, owner first, ordered by when it was queued.
    pub batches: Vec<Json>,
    /// Records the page could not queue.
    pub over: f64,
    /// Frames that answered.
    pub frames: usize,
}

/// The page side of the mutation stream.
#[derive(Debug, Clone)]
pub(crate) struct MutationStream {
    enabled: bool,
    recorder_options: Json,
    capture_timeout_ms: u64,
}

impl MutationStream {
    pub fn ignore_selectors(&mut self, selectors: &[String]) {
        if let Json::Object(options) = &mut self.recorder_options {
            options.insert(
                "ignoreSelectors",
                Json::Array(selectors.iter().map(Json::from).collect()),
            );
        }
    }
    /// `enabled` is the resolved `dom.mutations`.
    pub fn new(
        enabled: bool,
        redact_selectors: &[String],
        max_queued: Option<u64>,
        live_state: bool,
        capture_timeout_ms: u64,
    ) -> Self {
        let assets = trace_assets();
        let selectors = redact_selectors.iter().map(Json::from).collect::<Vec<_>>();
        let recorder_options = JsonObject::new()
            .with("globalName", assets.recorder_global.as_str())
            .with("redactSelectors", selectors)
            .with("redacted", assets.redacted.as_str())
            .with(
                "maxQueued",
                max_queued.unwrap_or(DEFAULT_MAX_QUEUED_MUTATIONS),
            )
            .with("liveState", live_state);
        Self {
            enabled,
            recorder_options: Json::Object(recorder_options),
            capture_timeout_ms,
        }
    }

    /// One result per frame that answered.
    ///
    /// Engines here evaluate in the main frame only, so this is always one
    /// result; child frames still report through their own init script once a
    /// later engine evaluates in them.
    async fn evaluate_in_frames(
        page: &dyn TracePage,
        source: &str,
        argument: &Json,
    ) -> Result<Vec<Json>, String> {
        Ok(vec![page.evaluate_function(source, argument).await?])
    }

    /// Install the recorder into the documents that already exist; the error
    /// to drop as `mutation-recorder`, if any.
    pub async fn install(&self, page: &dyn TracePage) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }
        let source = &trace_assets().capture.install_mutation_recorder;
        Self::evaluate_in_frames(page, source, &self.recorder_options)
            .await
            .map(|_| ())
    }

    /// Register the recorder for every future document.
    ///
    /// `Ok(None)` when there is nothing to undo later; the error is dropped as
    /// `mutation-recorder-init`.
    pub async fn install_persistent(&self, page: &dyn TracePage) -> Result<Option<String>, String> {
        if !self.enabled {
            return Ok(None);
        }
        let source = &trace_assets().capture.install_mutation_recorder;
        page.add_init_script(source, &self.recorder_options).await
    }

    /// What every frame had queued, under the capture deadline; `Ok(None)`
    /// when the stream is off. [`collect_batches`] makes one interval of it.
    pub async fn drain(&self, page: &dyn TracePage) -> Result<Option<Vec<Json>>, String> {
        if !self.enabled {
            return Ok(None);
        }
        let assets = trace_assets();
        let global = Json::from(assets.recorder_global.as_str());
        with_deadline(
            Self::evaluate_in_frames(page, &assets.capture.drain_mutations, &global),
            self.capture_timeout_ms,
            "trace mutation drain",
        )
        .await
        .map(Some)
    }

    /// Switch the recorder off in every document that has one.
    pub async fn stop(&self, page: &dyn TracePage) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }
        let assets = trace_assets();
        let global = Json::from(assets.recorder_global.as_str());
        Self::evaluate_in_frames(page, &assets.capture.stop_mutation_recorder, &global)
            .await
            .map(|_| ())
    }
}

/// `at ?? 0`; the in-page recorder always writes a number there.
fn queued_at(batch: &Json) -> f64 {
    batch.get("at").and_then(Json::as_f64).unwrap_or(0.0)
}

/// Merge every frame's batches into one interval, ordered by queue time.
///
/// `owner` goes ahead of each batch, so a batch that names its own frame or
/// navigation keeps its own.
pub(crate) fn collect_batches(drained: &[Json], owner: &JsonObject) -> Drained {
    let mut batches = Vec::new();
    let mut over = 0.0;
    for frame in drained {
        over += frame.get("dropped").and_then(Json::as_f64).unwrap_or(0.0);
        let frame_batches = frame.get("batches").and_then(Json::as_array);
        for batch in frame_batches.into_iter().flatten() {
            let mut record = owner.clone();
            if let Some(fields) = batch.as_object() {
                record.extend_from(fields);
            }
            batches.push(Json::Object(record));
        }
    }
    // A stable sort, as `Array.prototype.sort` is: equal times keep the order
    // the frames reported them in.
    batches.sort_by(|left, right| {
        queued_at(left)
            .partial_cmp(&queued_at(right))
            .unwrap_or(Ordering::Equal)
    });
    Drained {
        batches,
        over,
        frames: drained.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batches_are_owned_and_ordered() {
        let frame = Json::parse(
            r#"{"batches":[{"at":2,"records":[]},{"navigationId":"nav-9","at":1}],"dropped":3}"#,
        )
        .unwrap();
        let owner = JsonObject::new()
            .with("traceId", "trace-1")
            .with("navigationId", "nav-1");
        let drained = collect_batches(&[frame], &owner);
        assert_eq!(drained.over, 3.0);
        assert_eq!(drained.frames, 1);
        assert_eq!(
            drained
                .batches
                .iter()
                .map(Json::to_compact)
                .collect::<Vec<_>>(),
            vec![
                r#"{"traceId":"trace-1","navigationId":"nav-9","at":1}"#,
                r#"{"traceId":"trace-1","navigationId":"nav-1","at":2,"records":[]}"#,
            ]
        );
    }

    #[test]
    fn the_recorder_options_match_javascript() {
        let stream = MutationStream::new(true, &["[data-private]".to_string()], None, true, 0);
        assert_eq!(
            stream.recorder_options.to_compact(),
            r#"{"globalName":"__browserCommanderTrace__","redactSelectors":["[data-private]"],"redacted":"[redacted]","maxQueued":5000,"liveState":true}"#
        );
    }
}
