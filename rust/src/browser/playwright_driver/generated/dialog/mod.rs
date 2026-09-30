// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod accept_params;
pub mod accept_result;
pub mod dismiss_params;
pub mod dismiss_result;
pub mod initializer;
mod methods_0;
#[derive(Clone)]
pub struct DialogChannel(pub Channel<super::types::Dialog>);
impl DialogChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Dialog> {
        self.0.reference()
    }
}
