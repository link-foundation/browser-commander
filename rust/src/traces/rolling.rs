//! Bounded independently readable trace segments.
use super::{
    start_trace, JsonObject, TraceOptions, TracePage, TraceRecordError, TraceRecorder, TraceResult,
};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RotationOptions {
    pub max_bytes: u64,
    pub max_segments: usize,
}
impl Default for RotationOptions {
    fn default() -> Self {
        Self {
            max_bytes: 32 * 1024 * 1024,
            max_segments: 0,
        }
    }
}
pub struct RollingTraceRecorder {
    inner: TraceRecorder,
}
pub async fn start_rolling_trace(
    page: Arc<dyn TracePage>,
    mut options: TraceOptions,
    bounds: RotationOptions,
) -> Result<RollingTraceRecorder, TraceRecordError> {
    if bounds.max_bytes < 1024 || bounds.max_segments > 100 {
        return Err(TraceRecordError::Invalid("invalid rotation bounds".into()));
    }
    options.limits.rotation = Some(bounds);
    Ok(RollingTraceRecorder {
        inner: start_trace(page, options).await?,
    })
}
impl RollingTraceRecorder {
    pub fn path(&self) -> &Path {
        self.inner.path()
    }
    pub fn links(&self) -> Option<PathBuf> {
        self.inner.links()
    }
    pub fn bytes_written(&self) -> u64 {
        self.inner.bytes_written()
    }
    pub async fn checkpoint(&self, name: &str) -> Result<JsonObject, TraceRecordError> {
        self.inner.checkpoint(name).await
    }
    pub async fn event(
        &self,
        name: &str,
        data: JsonObject,
    ) -> Result<Option<JsonObject>, TraceRecordError> {
        self.inner.event(name, data).await
    }
    pub async fn stop(&self) -> Result<TraceResult, TraceRecordError> {
        self.inner.stop().await
    }
}
