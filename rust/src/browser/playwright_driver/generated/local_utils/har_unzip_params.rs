// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct HarUnzipParams {
    #[serde(rename = "zipFile")]
    pub zip_file: String,
    #[serde(rename = "harFile")]
    pub har_file: String,
    #[serde(rename = "resourcesDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources_dir: Option<String>,
}
