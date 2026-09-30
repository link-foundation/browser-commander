// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ExpectScreenshotParamsLocator {
    #[serde(rename = "frame")]
    pub frame: super::super::ChannelRef<super::super::types::Frame>,
    #[serde(rename = "selector")]
    pub selector: String,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ExpectScreenshotParamsType {
    #[serde(rename = "png")]
    Png,
    #[serde(rename = "webp")]
    Webp,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ExpectScreenshotParamsCaret {
    #[serde(rename = "hide")]
    Hide,
    #[serde(rename = "initial")]
    Initial,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ExpectScreenshotParamsAnimations {
    #[serde(rename = "disabled")]
    Disabled,
    #[serde(rename = "allow")]
    Allow,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ExpectScreenshotParamsScale {
    #[serde(rename = "css")]
    Css,
    #[serde(rename = "device")]
    Device,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ExpectScreenshotParamsMaskItem {
    #[serde(rename = "frame")]
    pub frame: super::super::ChannelRef<super::super::types::Frame>,
    #[serde(rename = "selector")]
    pub selector: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ExpectScreenshotParams {
    #[serde(rename = "expected")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected: Option<String>,
    #[serde(rename = "isNot")]
    pub is_not: bool,
    #[serde(rename = "locator")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locator: Option<ExpectScreenshotParamsLocator>,
    #[serde(rename = "comparator")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comparator: Option<String>,
    #[serde(rename = "maxDiffPixels")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_diff_pixels: Option<i64>,
    #[serde(rename = "maxDiffPixelRatio")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_diff_pixel_ratio: Option<f64>,
    #[serde(rename = "threshold")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub threshold: Option<f64>,
    #[serde(rename = "fullPage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_page: Option<bool>,
    #[serde(rename = "clip")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<Box<super::super::types::Rect>>,
    #[serde(rename = "type")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<ExpectScreenshotParamsType>,
    #[serde(rename = "omitBackground")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omit_background: Option<bool>,
    #[serde(rename = "caret")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub caret: Option<ExpectScreenshotParamsCaret>,
    #[serde(rename = "animations")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animations: Option<ExpectScreenshotParamsAnimations>,
    #[serde(rename = "scale")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale: Option<ExpectScreenshotParamsScale>,
    #[serde(rename = "mask")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Vec<ExpectScreenshotParamsMaskItem>>,
    #[serde(rename = "maskColor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask_color: Option<String>,
    #[serde(rename = "style")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
}
