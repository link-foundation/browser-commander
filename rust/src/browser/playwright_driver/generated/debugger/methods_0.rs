// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl DebuggerChannel {
    pub async fn request_pause(
        &self,
        params: request_pause_params::RequestPauseParams,
    ) -> playwright_rs::Result<request_pause_result::RequestPauseResult> {
        self.0.call("requestPause", params).await
    }
    pub async fn resume(
        &self,
        params: resume_params::ResumeParams,
    ) -> playwright_rs::Result<resume_result::ResumeResult> {
        self.0.call("resume", params).await
    }
    pub async fn next(
        &self,
        params: next_params::NextParams,
    ) -> playwright_rs::Result<next_result::NextResult> {
        self.0.call("next", params).await
    }
    pub async fn run_to(
        &self,
        params: run_to_params::RunToParams,
    ) -> playwright_rs::Result<run_to_result::RunToResult> {
        self.0.call("runTo", params).await
    }
    pub async fn enable(
        &self,
        params: enable_params::EnableParams,
    ) -> playwright_rs::Result<enable_result::EnableResult> {
        self.0.call("enable", params).await
    }
}
