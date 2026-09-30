// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct HarLookupParams {
    #[serde(rename = "harId")]
    pub har_id: String,
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "method")]
    pub method: String,
    #[serde(rename = "headers")]
    pub headers: Vec<Box<super::super::types::NameValue>>,
    #[serde(rename = "postData")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_data: Option<String>,
    #[serde(rename = "isNavigationRequest")]
    pub is_navigation_request: bool,
}
