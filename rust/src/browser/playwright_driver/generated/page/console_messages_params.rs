// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConsoleMessagesParams {
    #[serde(rename = "filter")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<Box<super::super::types::ConsoleMessagesFilter>>,
}
