// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GotoParams {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "waitUntil")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wait_until: Option<Box<super::super::types::LifecycleEvent>>,
    #[serde(rename = "referer")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub referer: Option<String>,
}
