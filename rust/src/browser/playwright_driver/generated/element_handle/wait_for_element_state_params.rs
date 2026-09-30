// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum WaitForElementStateParamsState {
    #[serde(rename = "visible")]
    Visible,
    #[serde(rename = "hidden")]
    Hidden,
    #[serde(rename = "stable")]
    Stable,
    #[serde(rename = "enabled")]
    Enabled,
    #[serde(rename = "disabled")]
    Disabled,
    #[serde(rename = "editable")]
    Editable,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WaitForElementStateParams {
    #[serde(rename = "state")]
    pub state: WaitForElementStateParamsState,
}
