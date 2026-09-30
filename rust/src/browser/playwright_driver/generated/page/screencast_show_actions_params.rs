// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ScreencastShowActionsParamsPosition {
    #[serde(rename = "top-left")]
    TopLeft,
    #[serde(rename = "top")]
    Top,
    #[serde(rename = "top-right")]
    TopRight,
    #[serde(rename = "bottom-left")]
    BottomLeft,
    #[serde(rename = "bottom")]
    Bottom,
    #[serde(rename = "bottom-right")]
    BottomRight,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ScreencastShowActionsParamsCursor {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "pointer")]
    Pointer,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScreencastShowActionsParams {
    #[serde(rename = "duration")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(rename = "position")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<ScreencastShowActionsParamsPosition>,
    #[serde(rename = "fontSize")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<i64>,
    #[serde(rename = "cursor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<ScreencastShowActionsParamsCursor>,
}
