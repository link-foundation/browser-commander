// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TracingStartChunkParams {
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "title")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}
