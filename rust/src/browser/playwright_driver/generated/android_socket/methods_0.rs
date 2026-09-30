// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl AndroidSocketChannel {
    pub async fn write(
        &self,
        params: write_params::WriteParams,
    ) -> playwright_rs::Result<write_result::WriteResult> {
        self.0.call("write", params).await
    }
    pub async fn close(
        &self,
        params: close_params::CloseParams,
    ) -> playwright_rs::Result<close_result::CloseResult> {
        self.0.call("close", params).await
    }
}
