// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StartTracingParams {
    #[serde(rename = "page")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<super::super::ChannelRef<super::super::types::Page>>,
    #[serde(rename = "screenshots")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshots: Option<bool>,
    #[serde(rename = "categories")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub categories: Option<Vec<String>>,
}
