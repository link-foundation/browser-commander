// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScreencastStartParamsSize {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScreencastStartParams {
    #[serde(rename = "size")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<ScreencastStartParamsSize>,
    #[serde(rename = "quality")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quality: Option<i64>,
    #[serde(rename = "sendFrames")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub send_frames: Option<bool>,
    #[serde(rename = "record")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record: Option<bool>,
}
