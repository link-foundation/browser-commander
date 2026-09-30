// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SelectorEngine {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "source")]
    pub source: String,
    #[serde(rename = "contentScript")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_script: Option<bool>,
}
