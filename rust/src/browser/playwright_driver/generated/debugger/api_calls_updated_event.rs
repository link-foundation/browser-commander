// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ApiCallsUpdatedEventApiCallsItemLocation {
    #[serde(rename = "file")]
    pub file: String,
    #[serde(rename = "line")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<i64>,
    #[serde(rename = "column")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ApiCallsUpdatedEventApiCallsItemStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "success")]
    Success,
    #[serde(rename = "error")]
    Error,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ApiCallsUpdatedEventApiCallsItem {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "location")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<ApiCallsUpdatedEventApiCallsItemLocation>,
    #[serde(rename = "newLogEntries")]
    pub new_log_entries: Vec<String>,
    #[serde(rename = "actionPoint")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action_point: Option<Box<super::super::types::Point>>,
    #[serde(rename = "status")]
    pub status: ApiCallsUpdatedEventApiCallsItemStatus,
    #[serde(rename = "error")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ApiCallsUpdatedEvent {
    #[serde(rename = "apiCalls")]
    pub api_calls: Vec<ApiCallsUpdatedEventApiCallsItem>,
}
