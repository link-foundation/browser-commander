// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ContinueParams {
    #[serde(rename = "url")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "method")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(rename = "headers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "postData")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_data: Option<String>,
    #[serde(rename = "isFallback")]
    pub is_fallback: bool,
}
