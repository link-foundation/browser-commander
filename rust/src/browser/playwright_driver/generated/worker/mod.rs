// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_event;
pub mod console_event;
pub mod disconnect_params;
pub mod disconnect_result;
pub mod evaluate_expression_handle_params;
pub mod evaluate_expression_handle_result;
pub mod evaluate_expression_params;
pub mod evaluate_expression_result;
pub mod initializer;
mod methods_0;
pub mod update_subscription_params;
pub mod update_subscription_result;
#[derive(Clone)]
pub struct WorkerChannel(pub Channel<super::types::Worker>);
impl WorkerChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Worker> {
        self.0.reference()
    }
}
