// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod api_calls_updated_event;
pub mod enable_params;
pub mod enable_result;
pub mod initializer;
mod methods_0;
pub mod next_params;
pub mod next_result;
pub mod paused_state_changed_event;
pub mod request_pause_params;
pub mod request_pause_result;
pub mod resume_params;
pub mod resume_result;
pub mod run_to_params;
pub mod run_to_result;
#[derive(Clone)]
pub struct DebuggerChannel(pub Channel<super::types::Debugger>);
impl DebuggerChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Debugger> {
        self.0.reference()
    }
}
