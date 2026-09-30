// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct QuerySelectorResult {
    #[serde(rename = "element")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub element: Option<super::super::ChannelRef<super::super::types::ElementHandle>>,
}
