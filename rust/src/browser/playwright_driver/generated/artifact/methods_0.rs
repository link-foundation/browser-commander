// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl ArtifactChannel {
    pub async fn path_after_finished(
        &self,
        params: path_after_finished_params::PathAfterFinishedParams,
    ) -> playwright_rs::Result<path_after_finished_result::PathAfterFinishedResult> {
        self.0.call("pathAfterFinished", params).await
    }
    pub async fn save_as(
        &self,
        params: save_as_params::SaveAsParams,
    ) -> playwright_rs::Result<save_as_result::SaveAsResult> {
        self.0.call("saveAs", params).await
    }
    pub async fn save_as_stream(
        &self,
        params: save_as_stream_params::SaveAsStreamParams,
    ) -> playwright_rs::Result<save_as_stream_result::SaveAsStreamResult> {
        self.0.call("saveAsStream", params).await
    }
    pub async fn failure(
        &self,
        params: failure_params::FailureParams,
    ) -> playwright_rs::Result<failure_result::FailureResult> {
        self.0.call("failure", params).await
    }
    pub async fn stream(
        &self,
        params: stream_params::StreamParams,
    ) -> playwright_rs::Result<stream_result::StreamResult> {
        self.0.call("stream", params).await
    }
    pub async fn cancel(
        &self,
        params: cancel_params::CancelParams,
    ) -> playwright_rs::Result<cancel_result::CancelResult> {
        self.0.call("cancel", params).await
    }
    pub async fn delete(
        &self,
        params: delete_params::DeleteParams,
    ) -> playwright_rs::Result<delete_result::DeleteResult> {
        self.0.call("delete", params).await
    }
}
