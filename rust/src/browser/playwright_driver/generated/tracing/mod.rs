// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod har_export_params;
pub mod har_export_result;
pub mod har_start_params;
pub mod har_start_result;
pub mod initializer;
mod methods_0;
pub mod tracing_group_end_params;
pub mod tracing_group_end_result;
pub mod tracing_group_params;
pub mod tracing_group_result;
pub mod tracing_start_chunk_params;
pub mod tracing_start_chunk_result;
pub mod tracing_start_params;
pub mod tracing_start_result;
pub mod tracing_stop_chunk_params;
pub mod tracing_stop_chunk_result;
pub mod tracing_stop_params;
pub mod tracing_stop_result;
#[derive(Clone)]
pub struct TracingChannel(pub Channel<super::types::Tracing>);
impl TracingChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Tracing> {
        self.0.reference()
    }
}
