// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PinchCloseParams {
    #[serde(rename = "androidSelector")]
    pub android_selector: Box<super::super::types::AndroidSelector>,
    #[serde(rename = "percent")]
    pub percent: f64,
    #[serde(rename = "speed")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
}
