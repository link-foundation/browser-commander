// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod dispose_api_response_params;
pub mod dispose_api_response_result;
pub mod dispose_params;
pub mod dispose_result;
pub mod fetch_log_params;
pub mod fetch_log_result;
pub mod fetch_params;
pub mod fetch_response_body_params;
pub mod fetch_response_body_result;
pub mod fetch_result;
pub mod initializer;
mod methods_0;
pub mod storage_state_params;
pub mod storage_state_result;
#[derive(Clone)]
pub struct APIRequestContextChannel(pub Channel<super::types::APIRequestContext>);
impl APIRequestContextChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::APIRequestContext> {
        self.0.reference()
    }
}
