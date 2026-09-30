// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl CDPSessionChannel {
    pub async fn send(
        &self,
        params: send_params::SendParams,
    ) -> playwright_rs::Result<send_result::SendResult> {
        self.0.call("send", params).await
    }
    pub async fn detach(
        &self,
        params: detach_params::DetachParams,
    ) -> playwright_rs::Result<detach_result::DetachResult> {
        self.0.call("detach", params).await
    }
}
