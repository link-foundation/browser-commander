// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StorageStateResult {
    #[serde(rename = "cookies")]
    pub cookies: Vec<Box<super::super::types::NetworkCookie>>,
    #[serde(rename = "origins")]
    pub origins: Vec<Box<super::super::types::OriginStorage>>,
}
