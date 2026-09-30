// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StackFrame {
    #[serde(rename = "file")]
    pub file: String,
    #[serde(rename = "line")]
    pub line: i64,
    #[serde(rename = "column")]
    pub column: i64,
    #[serde(rename = "function")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function: Option<String>,
}
