// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RequestEvent {
    #[serde(rename = "request")]
    pub request: super::super::ChannelRef<super::super::types::Request>,
    #[serde(rename = "page")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<super::super::ChannelRef<super::super::types::Page>>,
}
