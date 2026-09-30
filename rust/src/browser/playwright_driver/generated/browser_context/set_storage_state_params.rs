// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetStorageStateParamsStorageState {
    #[serde(rename = "cookies")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookies: Option<Vec<Box<super::super::types::SetNetworkCookie>>>,
    #[serde(rename = "origins")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origins: Option<Vec<Box<super::super::types::SetOriginStorage>>>,
    #[serde(rename = "credentials")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credentials: Option<Vec<Box<super::super::types::VirtualCredential>>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetStorageStateParams {
    #[serde(rename = "storageState")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_state: Option<SetStorageStateParamsStorageState>,
}
