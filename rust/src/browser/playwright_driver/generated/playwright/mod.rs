// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod initializer;
mod methods_0;
pub mod new_request_params;
pub mod new_request_result;
#[derive(Clone)]
pub struct PlaywrightChannel(pub Channel<super::types::Playwright>);
impl PlaywrightChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Playwright> {
        self.0.reference()
    }
}
