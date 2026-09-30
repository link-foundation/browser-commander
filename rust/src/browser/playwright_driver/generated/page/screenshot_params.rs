// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ScreenshotParamsType {
    #[serde(rename = "png")]
    Png,
    #[serde(rename = "jpeg")]
    Jpeg,
    #[serde(rename = "webp")]
    Webp,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ScreenshotParamsCaret {
    #[serde(rename = "hide")]
    Hide,
    #[serde(rename = "initial")]
    Initial,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ScreenshotParamsAnimations {
    #[serde(rename = "disabled")]
    Disabled,
    #[serde(rename = "allow")]
    Allow,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ScreenshotParamsScale {
    #[serde(rename = "css")]
    Css,
    #[serde(rename = "device")]
    Device,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScreenshotParamsMaskItem {
    #[serde(rename = "frame")]
    pub frame: super::super::ChannelRef<super::super::types::Frame>,
    #[serde(rename = "selector")]
    pub selector: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScreenshotParams {
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<ScreenshotParamsType>,
    #[serde(rename = "quality")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<i64>,
    #[serde(rename = "fullPage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_page: Option<bool>,
    #[serde(rename = "clip")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<Box<super::super::types::Rect>>,
    #[serde(rename = "omitBackground")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omit_background: Option<bool>,
    #[serde(rename = "caret")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caret: Option<ScreenshotParamsCaret>,
    #[serde(rename = "animations")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<ScreenshotParamsAnimations>,
    #[serde(rename = "scale")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<ScreenshotParamsScale>,
    #[serde(rename = "mask")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Vec<ScreenshotParamsMaskItem>>,
    #[serde(rename = "maskColor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask_color: Option<String>,
    #[serde(rename = "style")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}
