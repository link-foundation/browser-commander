// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl DisposableChannel {
    pub async fn dispose(
        &self,
        params: dispose_params::DisposeParams,
    ) -> playwright_rs::Result<dispose_result::DisposeResult> {
        self.0.call("dispose", params).await
    }
}
