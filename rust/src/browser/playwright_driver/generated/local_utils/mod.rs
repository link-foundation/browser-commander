// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod add_stack_to_tracing_no_reply_params;
pub mod add_stack_to_tracing_no_reply_result;
pub mod connect_params;
pub mod connect_result;
pub mod glob_to_regex_params;
pub mod glob_to_regex_result;
pub mod har_close_params;
pub mod har_close_result;
pub mod har_lookup_params;
pub mod har_lookup_result;
pub mod har_open_params;
pub mod har_open_result;
pub mod har_unzip_params;
pub mod har_unzip_result;
pub mod initializer;
mod methods_0;
pub mod trace_discarded_params;
pub mod trace_discarded_result;
pub mod tracing_started_params;
pub mod tracing_started_result;
pub mod zip_params;
pub mod zip_result;
#[derive(Clone)]
pub struct LocalUtilsChannel(pub Channel<super::types::LocalUtils>);
impl LocalUtilsChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::LocalUtils> {
        self.0.reference()
    }
}
