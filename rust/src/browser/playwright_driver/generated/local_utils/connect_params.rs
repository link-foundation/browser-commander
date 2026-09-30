// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConnectParams {
    #[serde(rename = "endpoint")]
    pub endpoint: String,
    #[serde(rename = "headers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<serde_json::Value>,
    #[serde(rename = "exposeNetwork")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expose_network: Option<String>,
    #[serde(rename = "slowMo")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slow_mo: Option<f64>,
    #[serde(rename = "socksProxyRedirectPortForTest")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socks_proxy_redirect_port_for_test: Option<i64>,
}
