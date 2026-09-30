// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum HarExportParamsMode {
    #[serde(rename = "archive")]
    Archive,
    #[serde(rename = "entries")]
    Entries,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct HarExportParams {
    #[serde(rename = "harId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub har_id: Option<String>,
    #[serde(rename = "mode")]
    pub mode: HarExportParamsMode,
}
