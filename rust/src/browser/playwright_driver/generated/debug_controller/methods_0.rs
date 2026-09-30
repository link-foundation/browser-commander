// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl DebugControllerChannel {
    pub async fn initialize(
        &self,
        params: initialize_params::InitializeParams,
    ) -> playwright_rs::Result<initialize_result::InitializeResult> {
        self.0.call("initialize", params).await
    }
    pub async fn set_report_state_changed(
        &self,
        params: set_report_state_changed_params::SetReportStateChangedParams,
    ) -> playwright_rs::Result<set_report_state_changed_result::SetReportStateChangedResult> {
        self.0.call("setReportStateChanged", params).await
    }
    pub async fn set_recorder_mode(
        &self,
        params: set_recorder_mode_params::SetRecorderModeParams,
    ) -> playwright_rs::Result<set_recorder_mode_result::SetRecorderModeResult> {
        self.0.call("setRecorderMode", params).await
    }
    pub async fn highlight(
        &self,
        params: highlight_params::HighlightParams,
    ) -> playwright_rs::Result<highlight_result::HighlightResult> {
        self.0.call("highlight", params).await
    }
    pub async fn hide_highlight(
        &self,
        params: hide_highlight_params::HideHighlightParams,
    ) -> playwright_rs::Result<hide_highlight_result::HideHighlightResult> {
        self.0.call("hideHighlight", params).await
    }
    pub async fn resume(
        &self,
        params: resume_params::ResumeParams,
    ) -> playwright_rs::Result<resume_result::ResumeResult> {
        self.0.call("resume", params).await
    }
    pub async fn kill(
        &self,
        params: kill_params::KillParams,
    ) -> playwright_rs::Result<kill_result::KillResult> {
        self.0.call("kill", params).await
    }
}
