// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_event;
pub mod close_params;
pub mod close_result;
pub mod context_event;
pub mod default_user_agent_for_test_params;
pub mod default_user_agent_for_test_result;
pub mod disconnect_from_reused_context_params;
pub mod disconnect_from_reused_context_result;
pub mod initializer;
pub mod kill_for_tests_params;
pub mod kill_for_tests_result;
mod methods_0;
pub mod new_browser_cdp_session_params;
pub mod new_browser_cdp_session_result;
pub mod new_context_for_reuse_params;
pub mod new_context_for_reuse_result;
pub mod new_context_params;
pub mod new_context_result;
pub mod start_server_params;
pub mod start_server_result;
pub mod start_tracing_params;
pub mod start_tracing_result;
pub mod stop_server_params;
pub mod stop_server_result;
pub mod stop_tracing_params;
pub mod stop_tracing_result;
#[derive(Clone)]
pub struct BrowserChannel(pub Channel<super::types::Browser>);
impl BrowserChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Browser> {
        self.0.reference()
    }
}
