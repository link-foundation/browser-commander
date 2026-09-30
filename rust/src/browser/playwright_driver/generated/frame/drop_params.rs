// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DropParamsPayloadsItem {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "mimeType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(rename = "buffer")]
    pub buffer: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DropParamsDataItem {
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "value")]
    pub value: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DropParams {
    #[serde(rename = "selector")]
    pub selector: String,
    #[serde(rename = "strict")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
    #[serde(rename = "position")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<Box<super::super::types::Point>>,
    #[serde(rename = "payloads")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payloads: Option<Vec<DropParamsPayloadsItem>>,
    #[serde(rename = "localPaths")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_paths: Option<Vec<String>>,
    #[serde(rename = "streams")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streams: Option<Vec<super::super::ChannelRef<super::super::types::WritableStream>>>,
    #[serde(rename = "data")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Vec<DropParamsDataItem>>,
}
