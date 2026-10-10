//! Bounded independently readable trace segments.
use super::{
    start_trace, JsonObject, TraceOptions, TracePage, TraceRecordError, TraceRecorder, TraceResult,
};
use serde_json::json;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
#[derive(Debug, Clone, Copy)]
pub struct RotationOptions {
    pub max_bytes: u64,
    pub max_segments: usize,
}
impl Default for RotationOptions {
    fn default() -> Self {
        Self {
            max_bytes: 32 * 1024 * 1024,
            max_segments: 4,
        }
    }
}
struct State {
    current: TraceRecorder,
    segments: Vec<String>,
    sequence: u64,
    result: Option<TraceResult>,
    failure: Option<String>,
}
pub struct RollingTraceRecorder {
    root: PathBuf,
    page: Arc<dyn TracePage>,
    options: TraceOptions,
    bounds: RotationOptions,
    state: Arc<tokio::sync::Mutex<State>>,
    timer: tokio::task::JoinHandle<()>,
}
async fn open(
    page: Arc<dyn TracePage>,
    options: &TraceOptions,
    bounds: RotationOptions,
    sequence: u64,
) -> Result<TraceRecorder, TraceRecordError> {
    let mut options = options.clone();
    options.output = options.output.join(format!("segment-{sequence:06}"));
    options.limits.max_bundle_bytes = Some(bounds.max_bytes);
    if let Some(links) = &mut options.links {
        links.output = options.output.join("trace.lino");
    }
    start_trace(page, options).await
}
fn index(root: &Path, segments: &[String]) -> Result<(), TraceRecordError> {
    let temporary = root.join("segments.json.tmp");
    crate::capture_encoding::private_write(
        &temporary,
        json!({"segments":segments}).to_string().as_bytes(),
    )?;
    std::fs::rename(temporary, root.join("segments.json"))?;
    Ok(())
}
async fn rotate(
    state: &mut State,
    page: Arc<dyn TracePage>,
    options: &TraceOptions,
    bounds: RotationOptions,
    extra: u64,
) -> Result<(), TraceRecordError> {
    if state.current.bytes_written() + extra < bounds.max_bytes * 4 / 5 {
        return Ok(());
    }
    state.current.stop().await?;
    state.sequence += 1;
    state.current = open(page, options, bounds, state.sequence).await?;
    state
        .segments
        .push(format!("segment-{:06}", state.sequence));
    while state.segments.len() > bounds.max_segments {
        std::fs::remove_dir_all(options.output.join(state.segments.remove(0)))?;
    }
    index(&options.output, &state.segments)
}
pub async fn start_rolling_trace(
    page: Arc<dyn TracePage>,
    options: TraceOptions,
    bounds: RotationOptions,
) -> Result<RollingTraceRecorder, TraceRecordError> {
    if bounds.max_bytes < 1024 || !(1..=100).contains(&bounds.max_segments) {
        return Err(TraceRecordError::Invalid("invalid rotation bounds".into()));
    }
    let current = open(page.clone(), &options, bounds, 1).await?;
    let segments = vec!["segment-000001".into()];
    index(&options.output, &segments)?;
    let state = Arc::new(tokio::sync::Mutex::new(State {
        current,
        segments,
        sequence: 1,
        result: None,
        failure: None,
    }));
    let weak = Arc::downgrade(&state);
    let target = page.clone();
    let config = options.clone();
    let timer = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let Some(state) = weak.upgrade() else { return };
            let mut state = state.lock().await;
            if state.result.is_some() {
                return;
            }
            if let Err(error) = rotate(&mut state, target.clone(), &config, bounds, 0).await {
                state.failure = Some(error.to_string());
                return;
            }
        }
    });
    Ok(RollingTraceRecorder {
        root: options.output.clone(),
        page,
        options,
        bounds,
        state,
        timer,
    })
}
impl RollingTraceRecorder {
    pub fn path(&self) -> &Path {
        &self.root
    }
    pub async fn checkpoint(&self, name: &str) -> Result<JsonObject, TraceRecordError> {
        let mut state = self.state.lock().await;
        if state.result.is_some() {
            return Err(TraceRecordError::Stopped);
        }
        rotate(&mut state, self.page.clone(), &self.options, self.bounds, 0).await?;
        state.current.checkpoint(name).await
    }
    pub async fn event(
        &self,
        name: &str,
        data: JsonObject,
    ) -> Result<Option<JsonObject>, TraceRecordError> {
        let mut state = self.state.lock().await;
        if state.result.is_some() {
            return Err(TraceRecordError::Stopped);
        }
        rotate(
            &mut state,
            self.page.clone(),
            &self.options,
            self.bounds,
            super::Json::Object(data.clone()).to_compact().len() as u64 + 256,
        )
        .await?;
        state.current.event(name, data).await
    }
    pub async fn stop(&self) -> Result<TraceResult, TraceRecordError> {
        self.timer.abort();
        let mut state = self.state.lock().await;
        if let Some(result) = &state.result {
            if let Some(error) = &state.failure {
                return Err(TraceRecordError::Invalid(error.clone()));
            }
            return Ok(result.clone());
        }
        let mut result = state.current.stop().await?;
        result.path = self.root.clone();
        state.result = Some(result.clone());
        if let Some(error) = &state.failure {
            return Err(TraceRecordError::Invalid(error.clone()));
        }
        Ok(result)
    }
}
impl Drop for RollingTraceRecorder {
    fn drop(&mut self) {
        self.timer.abort();
    }
}
