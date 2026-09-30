// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RemoteAddr {
    #[serde(rename = "ipAddress")]
    pub ip_address: String,
    #[serde(rename = "port")]
    pub port: i64,
}
