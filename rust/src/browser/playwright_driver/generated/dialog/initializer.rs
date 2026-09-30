// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "page")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<super::super::ChannelRef<super::super::types::Page>>,
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(rename = "message")]
    pub message: String,
    #[serde(rename = "defaultValue")]
    pub default_value: String,
}
