// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetInputFilesParamsPayloadsItem {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "mimeType")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(rename = "buffer")]
    pub buffer: String,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetInputFilesParams {
    #[serde(rename = "selector")]
    pub selector: String,
    #[serde(rename = "strict")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
    #[serde(rename = "payloads")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payloads: Option<Vec<SetInputFilesParamsPayloadsItem>>,
    #[serde(rename = "localDirectory")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_directory: Option<String>,
    #[serde(rename = "directoryStream")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory_stream: Option<super::super::ChannelRef<super::super::types::WritableStream>>,
    #[serde(rename = "localPaths")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_paths: Option<Vec<String>>,
    #[serde(rename = "streams")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub streams: Option<Vec<super::super::ChannelRef<super::super::types::WritableStream>>>,
}
