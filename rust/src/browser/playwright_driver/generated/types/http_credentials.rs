// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum HttpCredentialsSend {
    #[serde(rename = "always")]
    Always,
    #[serde(rename = "unauthorized")]
    Unauthorized,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct HttpCredentials {
    #[serde(rename = "username")]
    pub username: String,
    #[serde(rename = "password")]
    pub password: String,
    #[serde(rename = "origin")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(rename = "send")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub send: Option<HttpCredentialsSend>,
}
