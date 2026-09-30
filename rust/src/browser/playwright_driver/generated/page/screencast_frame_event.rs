// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScreencastFrameEvent {
    #[serde(rename = "frameId")]
    pub frame_id: i64,
    #[serde(rename = "data")]
    pub data: String,
    #[serde(rename = "timestamp")]
    pub timestamp: f64,
    #[serde(rename = "viewportWidth")]
    pub viewport_width: i64,
    #[serde(rename = "viewportHeight")]
    pub viewport_height: i64,
}
