// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SerializedArgument {
    #[serde(rename = "value")]
    pub value: Box<super::super::types::SerializedValue>,
    #[serde(rename = "handles")]
    pub handles: Vec<super::super::ChannelRef<super::super::AnyChannel>>,
}
