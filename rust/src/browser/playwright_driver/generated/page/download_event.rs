// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DownloadEvent {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "suggestedFilename")]
    pub suggested_filename: String,
    #[serde(rename = "artifact")]
    pub artifact: super::super::ChannelRef<super::super::types::Artifact>,
}
