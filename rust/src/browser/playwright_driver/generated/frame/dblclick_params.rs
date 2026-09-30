// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum DblclickParamsScroll {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "none")]
    None,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum DblclickParamsModifiersItem {
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
pub enum DblclickParamsButton {
    #[serde(rename = "left")]
    Left,
    #[serde(rename = "right")]
    Right,
    #[serde(rename = "middle")]
    Middle,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DblclickParams {
    #[serde(rename = "selector")]
    pub selector: String,
    #[serde(rename = "strict")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
    #[serde(rename = "force")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
    #[serde(rename = "scroll")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll: Option<DblclickParamsScroll>,
    #[serde(rename = "modifiers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modifiers: Option<Vec<DblclickParamsModifiersItem>>,
    #[serde(rename = "position")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Box<super::super::types::Point>>,
    #[serde(rename = "delay")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<f64>,
    #[serde(rename = "button")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub button: Option<DblclickParamsButton>,
    #[serde(rename = "trial")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial: Option<bool>,
    #[serde(rename = "steps")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub steps: Option<i64>,
}
