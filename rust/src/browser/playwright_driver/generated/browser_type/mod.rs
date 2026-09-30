// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod connect_over_cdp_params;
pub mod connect_over_cdp_result;
pub mod connect_to_worker_params;
pub mod connect_to_worker_result;
pub mod initializer;
pub mod launch_params;
pub mod launch_persistent_context_params;
pub mod launch_persistent_context_result;
pub mod launch_result;
mod methods_0;
#[derive(Clone)]
pub struct BrowserTypeChannel(pub Channel<super::types::BrowserType>);
impl BrowserTypeChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::BrowserType> {
        self.0.reference()
    }
}
