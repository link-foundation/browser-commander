// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ServerAddrResult {
    #[serde(rename = "value")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<Box<super::super::types::RemoteAddr>>,
}
