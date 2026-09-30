// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "frame")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<super::super::ChannelRef<super::super::types::Frame>>,
    #[serde(rename = "serviceWorker")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_worker: Option<super::super::ChannelRef<super::super::types::Worker>>,
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    #[serde(rename = "method")]
    pub method: String,
    #[serde(rename = "postData")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_data: Option<String>,
    #[serde(rename = "headers")]
    pub headers: Vec<Box<super::super::types::NameValue>>,
    #[serde(rename = "isNavigationRequest")]
    pub is_navigation_request: bool,
    #[serde(rename = "redirectedFrom")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirected_from: Option<super::super::ChannelRef<super::super::types::Request>>,
}
