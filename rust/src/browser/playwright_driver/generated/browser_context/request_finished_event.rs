// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RequestFinishedEvent {
    #[serde(rename = "request")]
    pub request: super::super::ChannelRef<super::super::types::Request>,
    #[serde(rename = "response")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response: Option<super::super::ChannelRef<super::super::types::Response>>,
    #[serde(rename = "responseEndTiming")]
    pub response_end_timing: f64,
    #[serde(rename = "page")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<super::super::ChannelRef<super::super::types::Page>>,
}
