// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl DialogChannel {
    pub async fn accept(
        &self,
        params: accept_params::AcceptParams,
    ) -> playwright_rs::Result<accept_result::AcceptResult> {
        self.0.call("accept", params).await
    }
    pub async fn dismiss(
        &self,
        params: dismiss_params::DismissParams,
    ) -> playwright_rs::Result<dismiss_result::DismissResult> {
        self.0.call("dismiss", params).await
    }
}
