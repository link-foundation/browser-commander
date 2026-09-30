// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct VirtualCredential {
    #[serde(rename = "id")]
    pub id: String,
    #[serde(rename = "rpId")]
    pub rp_id: String,
    #[serde(rename = "userHandle")]
    pub user_handle: String,
    #[serde(rename = "privateKey")]
    pub private_key: String,
    #[serde(rename = "publicKey")]
    pub public_key: String,
}
