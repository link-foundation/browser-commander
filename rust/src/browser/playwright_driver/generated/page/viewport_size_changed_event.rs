// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ViewportSizeChangedEventViewportSize {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ViewportSizeChangedEvent {
    #[serde(rename = "viewportSize")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport_size: Option<ViewportSizeChangedEventViewportSize>,
}
