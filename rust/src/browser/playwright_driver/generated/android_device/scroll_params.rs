// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ScrollParamsDirection {
    #[serde(rename = "up")]
    Up,
    #[serde(rename = "down")]
    Down,
    #[serde(rename = "left")]
    Left,
    #[serde(rename = "right")]
    Right,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScrollParams {
    #[serde(rename = "androidSelector")]
    pub android_selector: Box<super::super::types::AndroidSelector>,
    #[serde(rename = "direction")]
    pub direction: ScrollParamsDirection,
    #[serde(rename = "percent")]
    pub percent: f64,
    #[serde(rename = "speed")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed: Option<f64>,
}
