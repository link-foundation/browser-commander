// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod initializer;
mod methods_0;
pub mod socks_closed_event;
pub mod socks_connected_params;
pub mod socks_connected_result;
pub mod socks_data_event;
pub mod socks_data_params;
pub mod socks_data_result;
pub mod socks_end_params;
pub mod socks_end_result;
pub mod socks_error_params;
pub mod socks_error_result;
pub mod socks_failed_params;
pub mod socks_failed_result;
pub mod socks_requested_event;
#[derive(Clone)]
pub struct SocksSupportChannel(pub Channel<super::types::SocksSupport>);
impl SocksSupportChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::SocksSupport> {
        self.0.reference()
    }
}
