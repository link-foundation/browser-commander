// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GrantPermissionsParams {
    #[serde(rename = "permissions")]
    pub permissions: Vec<String>,
    #[serde(rename = "origin")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
}
