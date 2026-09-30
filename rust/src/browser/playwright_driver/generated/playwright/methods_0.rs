// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl PlaywrightChannel {
    pub async fn new_request(
        &self,
        params: new_request_params::NewRequestParams,
    ) -> playwright_rs::Result<new_request_result::NewRequestResult> {
        self.0.call("newRequest", params).await
    }
}
