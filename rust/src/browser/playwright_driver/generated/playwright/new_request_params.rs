// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewRequestParamsClientCertificatesItem {
    #[serde(rename = "origin")]
    pub origin: String,
    #[serde(rename = "cert")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert: Option<String>,
    #[serde(rename = "key")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(rename = "passphrase")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
    #[serde(rename = "pfx")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pfx: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewRequestParamsProxy {
    #[serde(rename = "server")]
    pub server: String,
    #[serde(rename = "bypass")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bypass: Option<String>,
    #[serde(rename = "username")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(rename = "password")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewRequestParamsStorageState {
    #[serde(rename = "cookies")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookies: Option<Vec<Box<super::super::types::NetworkCookie>>>,
    #[serde(rename = "origins")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origins: Option<Vec<Box<super::super::types::SetOriginStorage>>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewRequestParams {
    #[serde(rename = "baseURL")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(rename = "userAgent")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(rename = "ignoreHTTPSErrors")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_https_errors: Option<bool>,
    #[serde(rename = "extraHTTPHeaders")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_http_headers: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "failOnStatusCode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fail_on_status_code: Option<bool>,
    #[serde(rename = "clientCertificates")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_certificates: Option<Vec<NewRequestParamsClientCertificatesItem>>,
    #[serde(rename = "maxRedirects")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_redirects: Option<i64>,
    #[serde(rename = "httpCredentials")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_credentials: Option<Vec<Box<super::super::types::HttpCredentials>>>,
    #[serde(rename = "proxy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<NewRequestParamsProxy>,
    #[serde(rename = "storageState")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_state: Option<NewRequestParamsStorageState>,
    #[serde(rename = "tracesDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traces_dir: Option<String>,
}
