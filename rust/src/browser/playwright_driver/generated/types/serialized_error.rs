// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SerializedErrorError {
    #[serde(rename = "message")]
    pub message: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "stack")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SerializedError {
    #[serde(rename = "error")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<SerializedErrorError>,
    #[serde(rename = "value")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Box<super::super::types::SerializedValue>>,
}
