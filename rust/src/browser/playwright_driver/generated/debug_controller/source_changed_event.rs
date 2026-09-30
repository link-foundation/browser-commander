// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SourceChangedEvent {
    #[serde(rename = "text")]
    pub text: String,
    #[serde(rename = "header")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    #[serde(rename = "footer")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<String>,
    #[serde(rename = "actions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actions: Option<Vec<String>>,
}
