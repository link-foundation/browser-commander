// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PressParams {
    #[serde(rename = "key")]
    pub key: String,
    #[serde(rename = "delay")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<f64>,
    #[serde(rename = "noWaitAfter")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_wait_after: Option<bool>,
}
