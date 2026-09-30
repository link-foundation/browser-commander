// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod browser_window_params;
pub mod browser_window_result;
pub mod close_event;
pub mod console_event;
pub mod evaluate_expression_handle_params;
pub mod evaluate_expression_handle_result;
pub mod evaluate_expression_params;
pub mod evaluate_expression_result;
pub mod initializer;
mod methods_0;
pub mod update_subscription_params;
pub mod update_subscription_result;
#[derive(Clone)]
pub struct ElectronApplicationChannel(pub Channel<super::types::ElectronApplication>);
impl ElectronApplicationChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::ElectronApplication> {
        self.0.reference()
    }
}
