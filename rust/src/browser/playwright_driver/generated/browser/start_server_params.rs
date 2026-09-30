// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StartServerParams {
    #[serde(rename = "title")]
    pub title: String,
    #[serde(rename = "workspaceDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_dir: Option<String>,
    #[serde(rename = "metadata")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(rename = "host")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(rename = "port")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<i64>,
}
