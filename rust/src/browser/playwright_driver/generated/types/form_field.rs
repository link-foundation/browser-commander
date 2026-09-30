// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct FormFieldFile {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "mimeType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(rename = "buffer")]
    pub buffer: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct FormField {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "value")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(rename = "file")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file: Option<FormFieldFile>,
}
