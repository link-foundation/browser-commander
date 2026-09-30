// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct FileChooserEvent {
    #[serde(rename = "element")]
    pub element: super::super::ChannelRef<super::super::types::ElementHandle>,
    #[serde(rename = "isMultiple")]
    pub is_multiple: bool,
}
