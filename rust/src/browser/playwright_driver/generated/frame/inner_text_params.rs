// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InnerTextParams {
    #[serde(rename = "selector")]
    pub selector: String,
    #[serde(rename = "strict")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
}
