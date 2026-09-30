// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl JsonPipeChannel {
    pub async fn send(
        &self,
        params: send_params::SendParams,
    ) -> playwright_rs::Result<send_result::SendResult> {
        self.0.call("send", params).await
    }
    pub async fn close(
        &self,
        params: close_params::CloseParams,
    ) -> playwright_rs::Result<close_result::CloseResult> {
        self.0.call("close", params).await
    }
}
