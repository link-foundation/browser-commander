// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_event;
pub mod detach_params;
pub mod detach_result;
pub mod event_event;
pub mod initializer;
mod methods_0;
pub mod send_params;
pub mod send_result;
#[derive(Clone)]
pub struct CDPSessionChannel(pub Channel<super::types::CDPSession>);
impl CDPSessionChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::CDPSession> {
        self.0.reference()
    }
}
