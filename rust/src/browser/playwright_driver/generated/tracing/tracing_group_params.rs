// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TracingGroupParamsLocation {
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
pub struct TracingGroupParams {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "location")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<TracingGroupParamsLocation>,
}
