// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct CredentialsCreateParams {
    #[serde(rename = "rpId")]
    pub rp_id: String,
    #[serde(rename = "id")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(rename = "userHandle")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_handle: Option<String>,
    #[serde(rename = "privateKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,
    #[serde(rename = "publicKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
}
