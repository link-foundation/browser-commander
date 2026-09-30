// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ResolveLocatorHandlerNoReplyParams {
    #[serde(rename = "uid")]
    pub uid: i64,
    #[serde(rename = "remove")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remove: Option<bool>,
}
