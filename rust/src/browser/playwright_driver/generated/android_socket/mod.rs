// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_event;
pub mod close_params;
pub mod close_result;
pub mod data_event;
pub mod initializer;
mod methods_0;
pub mod write_params;
pub mod write_result;
#[derive(Clone)]
pub struct AndroidSocketChannel(pub Channel<super::types::AndroidSocket>);
impl AndroidSocketChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::AndroidSocket> {
        self.0.reference()
    }
}
