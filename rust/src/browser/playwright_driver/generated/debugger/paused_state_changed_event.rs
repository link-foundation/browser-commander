// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PausedStateChangedEventPausedDetailsLocation {
    #[serde(rename = "file")]
    pub file: String,
    #[serde(rename = "line")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<i64>,
    #[serde(rename = "column")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<i64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PausedStateChangedEventPausedDetails {
    #[serde(rename = "location")]
    pub location: PausedStateChangedEventPausedDetailsLocation,
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "stack")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PausedStateChangedEvent {
    #[serde(rename = "pausedDetails")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paused_details: Option<PausedStateChangedEventPausedDetails>,
}
