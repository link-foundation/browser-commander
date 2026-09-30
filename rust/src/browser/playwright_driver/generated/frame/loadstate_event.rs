// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LoadstateEvent {
    #[serde(rename = "add")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub add: Option<Box<super::super::types::LifecycleEvent>>,
    #[serde(rename = "remove")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remove: Option<Box<super::super::types::LifecycleEvent>>,
}
