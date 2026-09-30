// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RawResponseHeadersResult {
    #[serde(rename = "headers")]
    pub headers: Vec<Box<super::super::types::NameValue>>,
}
