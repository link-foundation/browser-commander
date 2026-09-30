// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct QuerySelectorAllResult {
    #[serde(rename = "elements")]
    pub elements: Vec<super::super::ChannelRef<super::super::types::ElementHandle>>,
}
