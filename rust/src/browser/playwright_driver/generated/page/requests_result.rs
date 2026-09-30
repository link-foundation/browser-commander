// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RequestsResult {
    #[serde(rename = "requests")]
    pub requests: Vec<super::super::ChannelRef<super::super::types::Request>>,
}
