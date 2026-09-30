// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AddCookiesParams {
    #[serde(rename = "cookies")]
    pub cookies: Vec<Box<super::super::types::SetNetworkCookie>>,
}
