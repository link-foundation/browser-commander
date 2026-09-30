// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GoForwardResult {
    #[serde(rename = "response")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<super::super::ChannelRef<super::super::types::Response>>,
}
