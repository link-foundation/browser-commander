// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_event;
pub mod frame_received_event;
pub mod frame_sent_event;
pub mod initializer;
pub mod open_event;
pub mod socket_error_event;
#[derive(Clone)]
pub struct WebSocketChannel(pub Channel<super::types::WebSocket>);
impl WebSocketChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::WebSocket> {
        self.0.reference()
    }
}
