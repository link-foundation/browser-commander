// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod initializer;
mod methods_0;
pub mod reject_params;
pub mod reject_result;
pub mod resolve_params;
pub mod resolve_result;
#[derive(Clone)]
pub struct BindingCallChannel(pub Channel<super::types::BindingCall>);
impl BindingCallChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::BindingCall> {
        self.0.reference()
    }
}
