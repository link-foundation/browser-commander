// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum OPFSEntryType {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "directory")]
    Directory,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct OPFSEntry {
    #[serde(rename = "path")]
    pub path: String,
    #[serde(rename = "type")]
    pub r#type: OPFSEntryType,
    #[serde(rename = "base64")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base64: Option<String>,
}
