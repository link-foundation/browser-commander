// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct IndexedDBDatabaseStoresItemRecordsItem {
    #[serde(rename = "key")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<serde_json::Value>,
    #[serde(rename = "keyEncoded")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_encoded: Option<serde_json::Value>,
    #[serde(rename = "value")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<serde_json::Value>,
    #[serde(rename = "valueEncoded")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_encoded: Option<serde_json::Value>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct IndexedDBDatabaseStoresItemIndexesItem {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "keyPath")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(rename = "keyPathArray")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path_array: Option<Vec<String>>,
    #[serde(rename = "multiEntry")]
    pub multi_entry: bool,
    #[serde(rename = "unique")]
    pub unique: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct IndexedDBDatabaseStoresItem {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "autoIncrement")]
    pub auto_increment: bool,
    #[serde(rename = "keyPath")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path: Option<String>,
    #[serde(rename = "keyPathArray")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_path_array: Option<Vec<String>>,
    #[serde(rename = "records")]
    pub records: Vec<IndexedDBDatabaseStoresItemRecordsItem>,
    #[serde(rename = "indexes")]
    pub indexes: Vec<IndexedDBDatabaseStoresItemIndexesItem>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct IndexedDBDatabase {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "version")]
    pub version: i64,
    #[serde(rename = "stores")]
    pub stores: Vec<IndexedDBDatabaseStoresItem>,
}
