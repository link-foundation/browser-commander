// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "parentFrame")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_frame: Option<super::super::ChannelRef<super::super::types::Frame>>,
    #[serde(rename = "loadStates")]
    pub load_states: Vec<Box<super::super::types::LifecycleEvent>>,
}
