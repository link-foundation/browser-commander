// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum AriaSnapshotJSONParamsMode {
    #[serde(rename = "ai")]
    Ai,
    #[serde(rename = "default")]
    Default,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AriaSnapshotJSONParams {
    #[serde(rename = "mode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<AriaSnapshotJSONParamsMode>,
    #[serde(rename = "selector")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(rename = "depth")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth: Option<i64>,
    #[serde(rename = "boxes")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boxes: Option<bool>,
}
