// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CreateTempFilesParamsItemsItem {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "lastModifiedMs")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified_ms: Option<f64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CreateTempFilesParams {
    #[serde(rename = "rootDirName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_dir_name: Option<String>,
    #[serde(rename = "items")]
    pub items: Vec<CreateTempFilesParamsItemsItem>,
}
