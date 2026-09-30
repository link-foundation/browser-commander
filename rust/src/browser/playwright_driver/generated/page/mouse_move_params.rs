// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct MouseMoveParams {
    #[serde(rename = "x")]
    pub x: f64,
    #[serde(rename = "y")]
    pub y: f64,
    #[serde(rename = "steps")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<i64>,
}
