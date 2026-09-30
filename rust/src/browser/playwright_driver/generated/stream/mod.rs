// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_params;
pub mod close_result;
pub mod initializer;
mod methods_0;
pub mod read_params;
pub mod read_result;
#[derive(Clone)]
pub struct StreamChannel(pub Channel<super::types::Stream>);
impl StreamChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Stream> {
        self.0.reference()
    }
}
