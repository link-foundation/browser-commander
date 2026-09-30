// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InitializerViewportSize {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "mainFrame")]
    pub main_frame: super::super::ChannelRef<super::super::types::Frame>,
    #[serde(rename = "viewportSize")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport_size: Option<InitializerViewportSize>,
    #[serde(rename = "isClosed")]
    pub is_closed: bool,
    #[serde(rename = "opener")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opener: Option<super::super::ChannelRef<super::super::types::Page>>,
    #[serde(rename = "video")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video: Option<super::super::ChannelRef<super::super::types::Artifact>>,
}
