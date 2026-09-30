// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "frame")]
    pub frame: super::super::ChannelRef<super::super::types::Frame>,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "args")]
    pub args: Vec<Box<super::super::types::SerializedValue>>,
}
