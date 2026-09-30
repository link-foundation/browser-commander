// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AndroidWebView {
    #[serde(rename = "pid")]
    pub pid: i64,
    #[serde(rename = "pkg")]
    pub pkg: String,
    #[serde(rename = "socketName")]
    pub socket_name: String,
}
