// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct HarStartParams {
    #[serde(rename = "page")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<super::super::ChannelRef<super::super::types::Page>>,
    #[serde(rename = "options")]
    pub options: Box<super::super::types::RecordHarOptions>,
}
