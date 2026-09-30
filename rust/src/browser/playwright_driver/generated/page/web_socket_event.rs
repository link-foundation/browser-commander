// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WebSocketEvent {
    #[serde(rename = "webSocket")]
    pub web_socket: super::super::ChannelRef<super::super::types::WebSocket>,
}
