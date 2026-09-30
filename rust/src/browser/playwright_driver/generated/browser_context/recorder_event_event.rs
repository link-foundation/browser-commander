// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum RecorderEventEventEvent {
    #[serde(rename = "actionAdded")]
    ActionAdded,
    #[serde(rename = "actionUpdated")]
    ActionUpdated,
    #[serde(rename = "signalAdded")]
    SignalAdded,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RecorderEventEvent {
    #[serde(rename = "event")]
    pub event: RecorderEventEventEvent,
    #[serde(rename = "data")]
    pub data: serde_json::Value,
    #[serde(rename = "page")]
    pub page: super::super::ChannelRef<super::super::types::Page>,
    #[serde(rename = "code")]
    pub code: String,
}
