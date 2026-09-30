// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct MessageFromServerEvent {
    #[serde(rename = "message")]
    pub message: String,
    #[serde(rename = "isBase64")]
    pub is_base64: bool,
}
