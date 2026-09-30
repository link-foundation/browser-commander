// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CredentialsGetParams {
    #[serde(rename = "rpId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rp_id: Option<String>,
    #[serde(rename = "id")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}
