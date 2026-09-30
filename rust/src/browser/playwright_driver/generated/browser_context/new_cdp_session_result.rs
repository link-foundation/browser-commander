// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewCDPSessionResult {
    #[serde(rename = "session")]
    pub session: super::super::ChannelRef<super::super::types::CDPSession>,
}
