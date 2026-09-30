// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct HighlightParams {
    #[serde(rename = "selector")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(rename = "ariaTemplate")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aria_template: Option<String>,
}
