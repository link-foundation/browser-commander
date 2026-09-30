// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum UpdateSubscriptionParamsEvent {
    #[serde(rename = "console")]
    Console,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct UpdateSubscriptionParams {
    #[serde(rename = "event")]
    pub event: UpdateSubscriptionParamsEvent,
    #[serde(rename = "enabled")]
    pub enabled: bool,
}
