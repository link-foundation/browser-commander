// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PageErrorEventLocation {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "line")]
    pub line: i64,
    #[serde(rename = "column")]
    pub column: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PageErrorEvent {
    #[serde(rename = "error")]
    pub error: Box<super::super::types::SerializedError>,
    #[serde(rename = "page")]
    pub page: super::super::ChannelRef<super::super::types::Page>,
    #[serde(rename = "location")]
    pub location: PageErrorEventLocation,
}
