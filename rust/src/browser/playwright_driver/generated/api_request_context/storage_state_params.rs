// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StorageStateParams {
    #[serde(rename = "indexedDB")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexed_db: Option<bool>,
    #[serde(rename = "opfs")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opfs: Option<bool>,
}
