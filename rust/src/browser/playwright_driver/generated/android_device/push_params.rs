// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PushParams {
    #[serde(rename = "file")]
    pub file: String,
    #[serde(rename = "path")]
    pub path: String,
    #[serde(rename = "mode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<i64>,
}
