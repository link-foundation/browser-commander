// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CommonScreenshotOptionsCaret {
    #[serde(rename = "hide")]
    Hide,
    #[serde(rename = "initial")]
    Initial,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CommonScreenshotOptionsAnimations {
    #[serde(rename = "disabled")]
    Disabled,
    #[serde(rename = "allow")]
    Allow,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum CommonScreenshotOptionsScale {
    #[serde(rename = "css")]
    Css,
    #[serde(rename = "device")]
    Device,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CommonScreenshotOptionsMaskItem {
    #[serde(rename = "frame")]
    pub frame: super::super::ChannelRef<super::super::types::Frame>,
    #[serde(rename = "selector")]
    pub selector: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CommonScreenshotOptions {
    #[serde(rename = "omitBackground")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omit_background: Option<bool>,
    #[serde(rename = "caret")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caret: Option<CommonScreenshotOptionsCaret>,
    #[serde(rename = "animations")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<CommonScreenshotOptionsAnimations>,
    #[serde(rename = "scale")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<CommonScreenshotOptionsScale>,
    #[serde(rename = "mask")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Vec<CommonScreenshotOptionsMaskItem>>,
    #[serde(rename = "maskColor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask_color: Option<String>,
    #[serde(rename = "style")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}
