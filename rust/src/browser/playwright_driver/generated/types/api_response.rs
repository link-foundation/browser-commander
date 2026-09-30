// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct APIResponse {
    #[serde(rename = "fetchUid")]
    pub fetch_uid: String,
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "status")]
    pub status: i64,
    #[serde(rename = "statusText")]
    pub status_text: String,
    #[serde(rename = "headers")]
    pub headers: Vec<Box<super::super::types::NameValue>>,
    #[serde(rename = "securityDetails")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security_details: Option<Box<super::super::types::SecurityDetails>>,
    #[serde(rename = "serverAddr")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_addr: Option<Box<super::super::types::RemoteAddr>>,
    #[serde(rename = "timing")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<Box<super::super::types::ResourceTiming>>,
    #[serde(rename = "responseEndTiming")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_end_timing: Option<f64>,
}
