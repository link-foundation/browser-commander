// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ClickParamsScroll {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "none")]
    None,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ClickParamsModifiersItem {
    #[serde(rename = "Alt")]
    Alt,
    #[serde(rename = "Control")]
    Control,
    #[serde(rename = "ControlOrMeta")]
    ControlOrMeta,
    #[serde(rename = "Meta")]
    Meta,
    #[serde(rename = "Shift")]
    Shift,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ClickParamsButton {
    #[serde(rename = "left")]
    Left,
    #[serde(rename = "right")]
    Right,
    #[serde(rename = "middle")]
    Middle,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ClickParams {
    #[serde(rename = "force")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
    #[serde(rename = "scroll")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll: Option<ClickParamsScroll>,
    #[serde(rename = "noWaitAfter")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_wait_after: Option<bool>,
    #[serde(rename = "modifiers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modifiers: Option<Vec<ClickParamsModifiersItem>>,
    #[serde(rename = "position")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Box<super::super::types::Point>>,
    #[serde(rename = "delay")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<f64>,
    #[serde(rename = "button")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub button: Option<ClickParamsButton>,
    #[serde(rename = "clickCount")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub click_count: Option<i64>,
    #[serde(rename = "trial")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial: Option<bool>,
    #[serde(rename = "steps")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<i64>,
}
