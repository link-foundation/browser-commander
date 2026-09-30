// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NavigatedEventNewDocument {
    #[serde(rename = "request")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request: Option<super::super::ChannelRef<super::super::types::Request>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NavigatedEvent {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "newDocument")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_document: Option<NavigatedEventNewDocument>,
    #[serde(rename = "error")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
