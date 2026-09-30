// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct HarOpenResult {
    #[serde(rename = "harId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub har_id: Option<String>,
    #[serde(rename = "error")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
