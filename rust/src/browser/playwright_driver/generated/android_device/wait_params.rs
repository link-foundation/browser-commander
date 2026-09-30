// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum WaitParamsState {
    #[serde(rename = "gone")]
    Gone,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WaitParams {
    #[serde(rename = "androidSelector")]
    pub android_selector: Box<super::super::types::AndroidSelector>,
    #[serde(rename = "state")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<WaitParamsState>,
}
