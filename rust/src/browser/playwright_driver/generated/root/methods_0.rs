// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl RootChannel {
    pub async fn initialize(
        &self,
        params: initialize_params::InitializeParams,
    ) -> playwright_rs::Result<initialize_result::InitializeResult> {
        self.0.call("initialize", params).await
    }
}
