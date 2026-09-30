// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SocksRequestedEvent {
    #[serde(rename = "uid")]
    pub uid: String,
    #[serde(rename = "host")]
    pub host: String,
    #[serde(rename = "port")]
    pub port: i64,
}
