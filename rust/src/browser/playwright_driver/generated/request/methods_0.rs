// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl RequestChannel {
    pub async fn response(
        &self,
        params: response_params::ResponseParams,
    ) -> playwright_rs::Result<response_result::ResponseResult> {
        self.0.call("response", params).await
    }
    pub async fn raw_request_headers(
        &self,
        params: raw_request_headers_params::RawRequestHeadersParams,
    ) -> playwright_rs::Result<raw_request_headers_result::RawRequestHeadersResult> {
        self.0.call("rawRequestHeaders", params).await
    }
}
