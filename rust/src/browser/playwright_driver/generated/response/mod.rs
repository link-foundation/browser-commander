// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod body_params;
pub mod body_result;
pub mod http_version_params;
pub mod http_version_result;
pub mod initializer;
mod methods_0;
pub mod raw_response_headers_params;
pub mod raw_response_headers_result;
pub mod security_details_params;
pub mod security_details_result;
pub mod server_addr_params;
pub mod server_addr_result;
pub mod sizes_params;
pub mod sizes_result;
#[derive(Clone)]
pub struct ResponseChannel(pub Channel<super::types::Response>);
impl ResponseChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Response> {
        self.0.reference()
    }
}
