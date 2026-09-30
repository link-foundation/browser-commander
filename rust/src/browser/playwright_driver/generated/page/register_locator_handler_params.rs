// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RegisterLocatorHandlerParams {
    #[serde(rename = "selector")]
    pub selector: String,
    #[serde(rename = "noWaitAfter")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_wait_after: Option<bool>,
}
