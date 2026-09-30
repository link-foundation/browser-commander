// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl StreamChannel {
    pub async fn read(
        &self,
        params: read_params::ReadParams,
    ) -> playwright_rs::Result<read_result::ReadResult> {
        self.0.call("read", params).await
    }
    pub async fn close(
        &self,
        params: close_params::CloseParams,
    ) -> playwright_rs::Result<close_result::CloseResult> {
        self.0.call("close", params).await
    }
}
