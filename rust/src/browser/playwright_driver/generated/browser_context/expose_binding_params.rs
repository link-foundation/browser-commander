// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ExposeBindingParams {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "noGlobal")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_global: Option<bool>,
}
