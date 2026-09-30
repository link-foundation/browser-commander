// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct FetchParams {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "encodedParams")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub encoded_params: Option<String>,
    #[serde(rename = "params")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "method")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(rename = "headers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "postData")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub post_data: Option<String>,
    #[serde(rename = "jsonData")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub json_data: Option<String>,
    #[serde(rename = "formData")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub form_data: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "multipartData")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multipart_data: Option<Vec<Box<super::super::types::FormField>>>,
    #[serde(rename = "failOnStatusCode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fail_on_status_code: Option<bool>,
    #[serde(rename = "ignoreHTTPSErrors")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_https_errors: Option<bool>,
    #[serde(rename = "maxRedirects")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_redirects: Option<i64>,
    #[serde(rename = "maxRetries")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_retries: Option<i64>,
}
