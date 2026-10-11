//! Public trace recorder operations and lifecycle.
use super::*;
use std::{fmt::Display, future::Future, path::Path};

impl TraceRecorder {
    /// Bytes currently written within the active segment.
    pub fn bytes_written(&self) -> u64 {
        self.inner.lock().bundle.written
    }
    /// The bundle directory.
    pub fn path(&self) -> &Path {
        &self.inner.settings.root
    }
    /// Directory accepting new records, including after automatic rotation.
    pub fn current_path(&self) -> PathBuf {
        self.inner.lock().bundle.active_root.clone()
    }
    pub fn segments(&self) -> Vec<String> {
        self.inner.lock().bundle.segments.clone()
    }

    /// The trace's mode.
    pub fn mode(&self) -> &str {
        &self.inner.settings.mode
    }

    /// The Links Notation export, when one is being written.
    pub fn links(&self) -> Option<PathBuf> {
        let state = self.inner.lock();
        match &state.result {
            Some(result) => result.links.clone(),
            None => state.bundle.links.as_ref().map(|sink| sink.path.clone()),
        }
    }

    /// Whether [`TraceRecorder::stop`] has run.
    pub fn stopped(&self) -> bool {
        self.inner.lock().stopped
    }

    /// The checkpoints taken so far.
    pub fn checkpoints(&self) -> Vec<JsonObject> {
        self.inner.lock().checkpoints.clone()
    }

    /// Capture a checkpoint taken by the automation.
    ///
    /// # Errors
    ///
    /// Fails after [`TraceRecorder::stop`], or when a strict trace drops
    /// something.
    pub async fn checkpoint(&self, name: &str) -> Result<JsonObject, TraceRecordError> {
        self.checkpoint_with(name, TraceCheckpointOptions::default())
            .await
    }

    /// Capture a checkpoint; `{index, name, actor, reason, url, truncated, members}`.
    ///
    /// # Errors
    ///
    /// As [`TraceRecorder::checkpoint`].
    pub async fn checkpoint_with(
        &self,
        name: &str,
        options: TraceCheckpointOptions,
    ) -> Result<JsonObject, TraceRecordError> {
        let _operation = self.inner.operations.lock().await;
        self.inner.flush().await;
        let actor = options.actor.as_deref().unwrap_or("automation");
        let reason = options
            .reason
            .as_deref()
            .unwrap_or(TraceCheckpointReason::CHECKPOINT);
        self.inner.checkpoint(name, actor, reason).await
    }

    /// Record something a caller cares about on the same timeline; the record
    /// written, or `None` once the trace has stopped.
    ///
    /// # Errors
    ///
    /// Fails when a strict trace drops the record.
    pub async fn event(
        &self,
        name: &str,
        data: JsonObject,
    ) -> Result<Option<JsonObject>, TraceRecordError> {
        let _operation = self.inner.operations.lock().await;
        self.inner.flush().await;
        let mut payload = JsonObject::new()
            .with("action", name)
            .with("actor", "caller");
        payload.extend_from(&data);
        self.inner.record(TraceEvent::INTERACTION, &payload)
    }

    /// Run one interaction and record it, as a traced commander method is.
    ///
    /// `target` is the selector or URL acted on; typed text never belongs
    /// there. The interaction is recorded only when the trace records the
    /// `interaction` source, and the work's own outcome is returned unchanged.
    pub async fn traced<T, E, F>(&self, action: &str, target: Option<&str>, work: F) -> Result<T, E>
    where
        E: Display,
        F: Future<Output = Result<T, E>>,
    {
        if !self.inner.records("interaction") {
            return work.await;
        }
        let (started, action_id) = {
            let mut state = self.inner.lock();
            (state.bundle.now_ms(), state.identity.next_action_id())
        };
        let outcome = work.await;
        self.inner.flush().await;
        let mut state = self.inner.lock();
        let duration = state.bundle.now_ms() - started;
        let mut payload = JsonObject::new()
            .with("actionId", action_id)
            .with("action", action)
            .with("target", Json::from(target))
            .with("durationMs", duration)
            .with("ok", outcome.is_ok());
        if let Err(error) = &outcome {
            payload.insert("error", error.to_string());
        }
        // The interaction's own result matters more than its record.
        let _ = self
            .inner
            .record_locked(&mut state, TraceEvent::INTERACTION, &payload);
        outcome
    }

    /// Stop recording and write the manifest; calling it again returns the
    /// first result.
    ///
    /// # Errors
    ///
    /// Fails when the manifest cannot be written or a strict trace drops
    /// something.
    pub async fn stop(&self) -> Result<TraceResult, TraceRecordError> {
        self.stop_with(TraceStopOptions::default()).await
    }

    /// [`TraceRecorder::stop`], discarding the bundle or recording the error
    /// the run ended with.
    ///
    /// # Errors
    ///
    /// As [`TraceRecorder::stop`].
    pub async fn stop_with(
        &self,
        options: TraceStopOptions,
    ) -> Result<TraceResult, TraceRecordError> {
        let _operation = self.inner.operations.lock().await;
        self.inner.flush().await;
        match self.inner.stop(options).await {
            Ok(result) => Ok(result),
            Err(error) => {
                self.inner.stop_pump();
                let init_script = {
                    let mut state = self.inner.lock();
                    state.stopped = true;
                    state.bundle.abort();
                    state.init_script.take()
                };
                let _ = self.inner.mutations.stop(self.inner.page.as_ref()).await;
                if let Some(identifier) = init_script {
                    let _ = self.inner.page.remove_init_script(&identifier).await;
                }
                Err(error)
            }
        }
    }
}

impl std::fmt::Debug for TraceRecorder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TraceRecorder")
            .field("path", &self.inner.settings.root)
            .field("mode", &self.inner.settings.mode)
            .field("stopped", &self.stopped())
            .finish()
    }
}
