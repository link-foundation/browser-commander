// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod dispose_params;
pub mod dispose_result;
pub mod evaluate_expression_handle_params;
pub mod evaluate_expression_handle_result;
pub mod evaluate_expression_params;
pub mod evaluate_expression_result;
pub mod get_property_list_params;
pub mod get_property_list_result;
pub mod get_property_params;
pub mod get_property_result;
pub mod initializer;
pub mod json_value_params;
pub mod json_value_result;
mod methods_0;
pub mod preview_updated_event;
#[derive(Clone)]
pub struct JSHandleChannel(pub Channel<super::types::JSHandle>);
impl JSHandleChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::JSHandle> {
        self.0.reference()
    }
}
