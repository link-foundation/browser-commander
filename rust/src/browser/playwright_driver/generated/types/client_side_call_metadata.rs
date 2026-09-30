// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ClientSideCallMetadata {
    #[serde(rename = "id")]
    pub id: i64,
    #[serde(rename = "stack")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<Vec<Box<super::super::types::StackFrame>>>,
}
