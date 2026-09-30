// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum WaitInfoPhase {
    #[serde(rename = "before")]
    Before,
    #[serde(rename = "after")]
    After,
    #[serde(rename = "log")]
    Log,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WaitInfo {
    #[serde(rename = "waitId")]
    pub wait_id: String,
    #[serde(rename = "phase")]
    pub phase: WaitInfoPhase,
    #[serde(rename = "event")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
    #[serde(rename = "message")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(rename = "error")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
