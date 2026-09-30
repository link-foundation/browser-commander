// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RecorderSourceHighlightItem {
    #[serde(rename = "line")]
    pub line: i64,
    #[serde(rename = "type")]
    pub r#type: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RecorderSource {
    #[serde(rename = "isRecorded")]
    pub is_recorded: bool,
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "label")]
    pub label: String,
    #[serde(rename = "text")]
    pub text: String,
    #[serde(rename = "language")]
    pub language: String,
    #[serde(rename = "highlight")]
    pub highlight: Vec<RecorderSourceHighlightItem>,
    #[serde(rename = "revealLine")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reveal_line: Option<i64>,
    #[serde(rename = "group")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
}
