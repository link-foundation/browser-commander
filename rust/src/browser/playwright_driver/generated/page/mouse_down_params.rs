// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum MouseDownParamsButton {
    #[serde(rename = "left")]
    Left,
    #[serde(rename = "right")]
    Right,
    #[serde(rename = "middle")]
    Middle,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct MouseDownParams {
    #[serde(rename = "button")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub button: Option<MouseDownParamsButton>,
    #[serde(rename = "clickCount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub click_count: Option<i64>,
}
