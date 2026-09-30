// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TapParamsScroll {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "none")]
    None,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TapParamsModifiersItem {
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

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TapParams {
    #[serde(rename = "force")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
    #[serde(rename = "scroll")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scroll: Option<TapParamsScroll>,
    #[serde(rename = "modifiers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modifiers: Option<Vec<TapParamsModifiersItem>>,
    #[serde(rename = "position")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Box<super::super::types::Point>>,
    #[serde(rename = "trial")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trial: Option<bool>,
}
