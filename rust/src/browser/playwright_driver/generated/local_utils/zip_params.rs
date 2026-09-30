// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ZipParamsMode {
    #[serde(rename = "write")]
    Write,
    #[serde(rename = "append")]
    Append,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ZipParams {
    #[serde(rename = "zipFile")]
    pub zip_file: String,
    #[serde(rename = "entries")]
    pub entries: Vec<Box<super::super::types::NameValue>>,
    #[serde(rename = "stacksId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stacks_id: Option<String>,
    #[serde(rename = "mode")]
    pub mode: ZipParamsMode,
    #[serde(rename = "includeSources")]
    pub include_sources: bool,
    #[serde(rename = "additionalSources")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additional_sources: Option<Vec<String>>,
}
