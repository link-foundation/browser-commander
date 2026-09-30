// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl TracingChannel {
    pub async fn tracing_start(
        &self,
        params: tracing_start_params::TracingStartParams,
    ) -> playwright_rs::Result<tracing_start_result::TracingStartResult> {
        self.0.call("tracingStart", params).await
    }
    pub async fn tracing_start_chunk(
        &self,
        params: tracing_start_chunk_params::TracingStartChunkParams,
    ) -> playwright_rs::Result<tracing_start_chunk_result::TracingStartChunkResult> {
        self.0.call("tracingStartChunk", params).await
    }
    pub async fn tracing_group(
        &self,
        params: tracing_group_params::TracingGroupParams,
    ) -> playwright_rs::Result<tracing_group_result::TracingGroupResult> {
        self.0.call("tracingGroup", params).await
    }
    pub async fn tracing_group_end(
        &self,
        params: tracing_group_end_params::TracingGroupEndParams,
    ) -> playwright_rs::Result<tracing_group_end_result::TracingGroupEndResult> {
        self.0.call("tracingGroupEnd", params).await
    }
    pub async fn tracing_stop_chunk(
        &self,
        params: tracing_stop_chunk_params::TracingStopChunkParams,
    ) -> playwright_rs::Result<tracing_stop_chunk_result::TracingStopChunkResult> {
        self.0.call("tracingStopChunk", params).await
    }
    pub async fn tracing_stop(
        &self,
        params: tracing_stop_params::TracingStopParams,
    ) -> playwright_rs::Result<tracing_stop_result::TracingStopResult> {
        self.0.call("tracingStop", params).await
    }
    pub async fn har_start(
        &self,
        params: har_start_params::HarStartParams,
    ) -> playwright_rs::Result<har_start_result::HarStartResult> {
        self.0.call("harStart", params).await
    }
    pub async fn har_export(
        &self,
        params: har_export_params::HarExportParams,
    ) -> playwright_rs::Result<har_export_result::HarExportResult> {
        self.0.call("harExport", params).await
    }
}
