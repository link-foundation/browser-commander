// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod hide_highlight_params;
pub mod hide_highlight_result;
pub mod highlight_params;
pub mod highlight_result;
pub mod initialize_params;
pub mod initialize_result;
pub mod initializer;
pub mod inspect_requested_event;
pub mod kill_params;
pub mod kill_result;
mod methods_0;
pub mod paused_event;
pub mod resume_params;
pub mod resume_result;
pub mod set_mode_requested_event;
pub mod set_recorder_mode_params;
pub mod set_recorder_mode_result;
pub mod set_report_state_changed_params;
pub mod set_report_state_changed_result;
pub mod source_changed_event;
pub mod state_changed_event;
#[derive(Clone)]
pub struct DebugControllerChannel(pub Channel<super::types::DebugController>);
impl DebugControllerChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::DebugController> {
        self.0.reference()
    }
}
