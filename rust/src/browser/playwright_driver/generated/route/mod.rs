// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod abort_params;
pub mod abort_result;
pub mod continue_params;
pub mod continue_result;
pub mod fulfill_params;
pub mod fulfill_result;
pub mod initializer;
mod methods_0;
pub mod redirect_navigation_request_params;
pub mod redirect_navigation_request_result;
#[derive(Clone)]
pub struct RouteChannel(pub Channel<super::types::Route>);
impl RouteChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Route> {
        self.0.reference()
    }
}
