// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct FulfillParams {
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(rename = "headers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "body")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(rename = "isBase64")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_base64: Option<bool>,
    #[serde(rename = "fetchResponseUid")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fetch_response_uid: Option<String>,
}
