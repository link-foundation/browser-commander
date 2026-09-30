// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl AndroidChannel {
    pub async fn devices(
        &self,
        params: devices_params::DevicesParams,
    ) -> playwright_rs::Result<devices_result::DevicesResult> {
        self.0.call("devices", params).await
    }
}
