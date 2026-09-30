// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewCDPSessionParams {
    #[serde(rename = "page")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<super::super::ChannelRef<super::super::types::Page>>,
    #[serde(rename = "frame")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<super::super::ChannelRef<super::super::types::Frame>>,
}
