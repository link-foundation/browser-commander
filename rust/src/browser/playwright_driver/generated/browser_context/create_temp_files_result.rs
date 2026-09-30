// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CreateTempFilesResult {
    #[serde(rename = "rootDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root_dir: Option<super::super::ChannelRef<super::super::types::WritableStream>>,
    #[serde(rename = "writableStreams")]
    pub writable_streams: Vec<super::super::ChannelRef<super::super::types::WritableStream>>,
}
