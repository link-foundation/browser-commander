// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TracingStopChunkResult {
    #[serde(rename = "artifact")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifact: Option<super::super::ChannelRef<super::super::types::Artifact>>,
    #[serde(rename = "entries")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entries: Option<Vec<Box<super::super::types::NameValue>>>,
}
