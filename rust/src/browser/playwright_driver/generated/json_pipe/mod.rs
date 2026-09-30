// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_params;
pub mod close_result;
pub mod closed_event;
pub mod initializer;
pub mod message_event;
mod methods_0;
pub mod send_params;
pub mod send_result;
#[derive(Clone)]
pub struct JsonPipeChannel(pub Channel<super::types::JsonPipe>);
impl JsonPipeChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::JsonPipe> {
        self.0.reference()
    }
}
