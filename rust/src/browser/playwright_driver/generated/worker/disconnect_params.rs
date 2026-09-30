// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DisconnectParams {
    #[serde(rename = "reason")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}
