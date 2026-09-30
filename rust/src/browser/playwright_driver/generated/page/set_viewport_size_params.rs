// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetViewportSizeParamsViewportSize {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetViewportSizeParams {
    #[serde(rename = "viewportSize")]
    pub viewport_size: SetViewportSizeParamsViewportSize,
}
