// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SelectTextParams {
    #[serde(rename = "force")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}
