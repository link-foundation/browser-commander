// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod add_cookies_params;
pub mod add_cookies_result;
pub mod add_init_script_params;
pub mod add_init_script_result;
pub mod binding_call_event;
pub mod clear_cookies_params;
pub mod clear_cookies_result;
pub mod clear_permissions_params;
pub mod clear_permissions_result;
pub mod clock_fast_forward_params;
pub mod clock_fast_forward_result;
pub mod clock_install_params;
pub mod clock_install_result;
pub mod clock_pause_at_params;
pub mod clock_pause_at_result;
pub mod clock_resume_params;
pub mod clock_resume_result;
pub mod clock_run_for_params;
pub mod clock_run_for_result;
pub mod clock_set_fixed_time_params;
pub mod clock_set_fixed_time_result;
pub mod clock_set_system_time_params;
pub mod clock_set_system_time_result;
pub mod close_event;
pub mod close_params;
pub mod close_result;
pub mod console_event;
pub mod cookies_params;
pub mod cookies_result;
pub mod create_temp_files_params;
pub mod create_temp_files_result;
pub mod credentials_create_params;
pub mod credentials_create_result;
pub mod credentials_delete_params;
pub mod credentials_delete_result;
pub mod credentials_get_params;
pub mod credentials_get_result;
pub mod credentials_install_params;
pub mod credentials_install_result;
pub mod dialog_closed_event;
pub mod dialog_event;
pub mod disable_recorder_params;
pub mod disable_recorder_result;
pub mod enable_recorder_params;
pub mod enable_recorder_result;
pub mod expose_binding_params;
pub mod expose_binding_result;
pub mod expose_console_api_params;
pub mod expose_console_api_result;
pub mod grant_permissions_params;
pub mod grant_permissions_result;
pub mod initializer;
mod methods_0;
mod methods_1;
pub mod new_cdp_session_params;
pub mod new_cdp_session_result;
pub mod new_page_params;
pub mod new_page_result;
pub mod page_error_event;
pub mod page_event;
pub mod pause_params;
pub mod pause_result;
pub mod recorder_event_event;
pub mod register_selector_engine_params;
pub mod register_selector_engine_result;
pub mod request_event;
pub mod request_failed_event;
pub mod request_finished_event;
pub mod response_event;
pub mod route_event;
pub mod service_worker_event;
pub mod set_extra_http_headers_params;
pub mod set_extra_http_headers_result;
pub mod set_geolocation_params;
pub mod set_geolocation_result;
pub mod set_http_credentials_params;
pub mod set_http_credentials_result;
pub mod set_network_interception_patterns_params;
pub mod set_network_interception_patterns_result;
pub mod set_offline_params;
pub mod set_offline_result;
pub mod set_storage_state_params;
pub mod set_storage_state_result;
pub mod set_test_id_attribute_name_params;
pub mod set_test_id_attribute_name_result;
pub mod set_web_socket_interception_patterns_params;
pub mod set_web_socket_interception_patterns_result;
pub mod storage_state_params;
pub mod storage_state_result;
pub mod update_subscription_params;
pub mod update_subscription_result;
pub mod web_socket_route_event;
#[derive(Clone)]
pub struct BrowserContextChannel(pub Channel<super::types::BrowserContext>);
impl BrowserContextChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::BrowserContext> {
        self.0.reference()
    }
}
