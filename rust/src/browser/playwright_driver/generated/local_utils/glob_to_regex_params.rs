// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GlobToRegexParams {
    #[serde(rename = "glob")]
    pub glob: String,
    #[serde(rename = "baseURL")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(rename = "webSocketUrl")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub web_socket_url: Option<bool>,
}
