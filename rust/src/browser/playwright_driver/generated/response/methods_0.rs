// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl ResponseChannel {
    pub async fn body(
        &self,
        params: body_params::BodyParams,
    ) -> playwright_rs::Result<body_result::BodyResult> {
        self.0.call("body", params).await
    }
    pub async fn security_details(
        &self,
        params: security_details_params::SecurityDetailsParams,
    ) -> playwright_rs::Result<security_details_result::SecurityDetailsResult> {
        self.0.call("securityDetails", params).await
    }
    pub async fn server_addr(
        &self,
        params: server_addr_params::ServerAddrParams,
    ) -> playwright_rs::Result<server_addr_result::ServerAddrResult> {
        self.0.call("serverAddr", params).await
    }
    pub async fn raw_response_headers(
        &self,
        params: raw_response_headers_params::RawResponseHeadersParams,
    ) -> playwright_rs::Result<raw_response_headers_result::RawResponseHeadersResult> {
        self.0.call("rawResponseHeaders", params).await
    }
    pub async fn http_version(
        &self,
        params: http_version_params::HttpVersionParams,
    ) -> playwright_rs::Result<http_version_result::HttpVersionResult> {
        self.0.call("httpVersion", params).await
    }
    pub async fn sizes(
        &self,
        params: sizes_params::SizesParams,
    ) -> playwright_rs::Result<sizes_result::SizesResult> {
        self.0.call("sizes", params).await
    }
}
