// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ScreencastShowOverlayParams {
    #[serde(rename = "html")]
    pub html: String,
    #[serde(rename = "duration")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}
