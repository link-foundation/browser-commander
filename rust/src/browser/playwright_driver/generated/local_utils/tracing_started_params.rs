// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TracingStartedParams {
    #[serde(rename = "tracesDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traces_dir: Option<String>,
    #[serde(rename = "traceName")]
    pub trace_name: String,
    #[serde(rename = "live")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live: Option<bool>,
}
