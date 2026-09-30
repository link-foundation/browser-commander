// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DispatchEventParams {
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(rename = "eventInit")]
    pub event_init: Box<super::super::types::SerializedArgument>,
}
