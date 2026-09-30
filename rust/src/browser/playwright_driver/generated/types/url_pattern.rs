// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct URLPattern {
    #[serde(rename = "hash")]
    pub hash: String,
    #[serde(rename = "hostname")]
    pub hostname: String,
    #[serde(rename = "password")]
    pub password: String,
    #[serde(rename = "pathname")]
    pub pathname: String,
    #[serde(rename = "port")]
    pub port: String,
    #[serde(rename = "protocol")]
    pub protocol: String,
    #[serde(rename = "search")]
    pub search: String,
    #[serde(rename = "username")]
    pub username: String,
}
