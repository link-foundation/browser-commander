// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct MetadataLocation {
    #[serde(rename = "file")]
    pub file: String,
    #[serde(rename = "line")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<i64>,
    #[serde(rename = "column")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<i64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Metadata {
    #[serde(rename = "location")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<MetadataLocation>,
    #[serde(rename = "title")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(rename = "internal")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub internal: Option<bool>,
    #[serde(rename = "stepId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    #[serde(rename = "timeout")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout: Option<f64>,
}
