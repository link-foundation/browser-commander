// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum WaitForSelectorParamsState {
    #[serde(rename = "attached")]
    Attached,
    #[serde(rename = "detached")]
    Detached,
    #[serde(rename = "visible")]
    Visible,
    #[serde(rename = "hidden")]
    Hidden,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WaitForSelectorParams {
    #[serde(rename = "selector")]
    pub selector: String,
    #[serde(rename = "strict")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
    #[serde(rename = "state")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<WaitForSelectorParamsState>,
}
