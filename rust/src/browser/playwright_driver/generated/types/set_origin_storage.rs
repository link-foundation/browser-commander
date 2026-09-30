// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetOriginStorage {
    #[serde(rename = "origin")]
    pub origin: String,
    #[serde(rename = "localStorage")]
    pub local_storage: Vec<Box<super::super::types::NameValue>>,
    #[serde(rename = "indexedDB")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indexed_db: Option<Vec<Box<super::super::types::IndexedDBDatabase>>>,
    #[serde(rename = "opfs")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opfs: Option<Vec<Box<super::super::types::OPFSEntry>>>,
}
