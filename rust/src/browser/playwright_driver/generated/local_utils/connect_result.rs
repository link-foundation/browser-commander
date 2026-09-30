// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConnectResult {
    #[serde(rename = "pipe")]
    pub pipe: super::super::ChannelRef<super::super::types::JsonPipe>,
    #[serde(rename = "headers")]
    pub headers: Vec<Box<super::super::types::NameValue>>,
}
