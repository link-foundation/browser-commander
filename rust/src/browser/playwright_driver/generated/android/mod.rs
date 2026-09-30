// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod devices_params;
pub mod devices_result;
pub mod initializer;
mod methods_0;
#[derive(Clone)]
pub struct AndroidChannel(pub Channel<super::types::Android>);
impl AndroidChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Android> {
        self.0.reference()
    }
}
