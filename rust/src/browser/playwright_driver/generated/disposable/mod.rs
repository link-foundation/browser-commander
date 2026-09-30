// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod dispose_params;
pub mod dispose_result;
pub mod initializer;
mod methods_0;
#[derive(Clone)]
pub struct DisposableChannel(pub Channel<super::types::Disposable>);
impl DisposableChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Disposable> {
        self.0.reference()
    }
}
