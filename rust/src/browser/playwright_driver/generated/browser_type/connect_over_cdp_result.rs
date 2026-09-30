// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConnectOverCDPResult {
    #[serde(rename = "browser")]
    pub browser: super::super::ChannelRef<super::super::types::Browser>,
    #[serde(rename = "defaultContext")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_context: Option<super::super::ChannelRef<super::super::types::BrowserContext>>,
}
