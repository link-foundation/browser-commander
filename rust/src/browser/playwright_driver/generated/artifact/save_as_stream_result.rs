// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SaveAsStreamResult {
    #[serde(rename = "stream")]
    pub stream: super::super::ChannelRef<super::super::types::Stream>,
}
