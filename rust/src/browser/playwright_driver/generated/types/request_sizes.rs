// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RequestSizes {
    #[serde(rename = "requestBodySize")]
    pub request_body_size: i64,
    #[serde(rename = "requestHeadersSize")]
    pub request_headers_size: i64,
    #[serde(rename = "responseBodySize")]
    pub response_body_size: i64,
    #[serde(rename = "responseHeadersSize")]
    pub response_headers_size: i64,
}
