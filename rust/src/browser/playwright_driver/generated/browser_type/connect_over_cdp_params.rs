// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConnectOverCDPParams {
    #[serde(rename = "endpointURL")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint_url: Option<String>,
    #[serde(rename = "headers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "slowMo")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slow_mo: Option<f64>,
    #[serde(rename = "isLocal")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_local: Option<bool>,
    #[serde(rename = "noDefaults")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_defaults: Option<bool>,
    #[serde(rename = "isWebView")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_web_view: Option<bool>,
    #[serde(rename = "artifactsDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifacts_dir: Option<String>,
    #[serde(rename = "transport")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
}
