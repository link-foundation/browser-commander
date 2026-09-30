// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod initializer;
mod methods_0;
pub mod raw_request_headers_params;
pub mod raw_request_headers_result;
pub mod response_params;
pub mod response_result;
#[derive(Clone)]
pub struct RequestChannel(pub Channel<super::types::Request>);
impl RequestChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Request> {
        self.0.reference()
    }
}
