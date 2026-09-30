// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_page_event;
pub mod close_page_params;
pub mod close_page_result;
pub mod close_server_event;
pub mod close_server_params;
pub mod close_server_result;
pub mod connect_params;
pub mod connect_result;
pub mod ensure_opened_params;
pub mod ensure_opened_result;
pub mod initializer;
pub mod message_from_page_event;
pub mod message_from_server_event;
mod methods_0;
pub mod send_to_page_params;
pub mod send_to_page_result;
pub mod send_to_server_params;
pub mod send_to_server_result;
#[derive(Clone)]
pub struct WebSocketRouteChannel(pub Channel<super::types::WebSocketRoute>);
impl WebSocketRouteChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::WebSocketRoute> {
        self.0.reference()
    }
}
