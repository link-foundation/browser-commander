// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct OwnerFrameResult {
    #[serde(rename = "frame")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<super::super::ChannelRef<super::super::types::Frame>>,
}
