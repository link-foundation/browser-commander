// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "request")]
    pub request: super::super::ChannelRef<super::super::types::Request>,
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "status")]
    pub status: i64,
    #[serde(rename = "statusText")]
    pub status_text: String,
    #[serde(rename = "headers")]
    pub headers: Vec<Box<super::super::types::NameValue>>,
    #[serde(rename = "timing")]
    pub timing: Box<super::super::types::ResourceTiming>,
    #[serde(rename = "fromServiceWorker")]
    pub from_service_worker: bool,
}
