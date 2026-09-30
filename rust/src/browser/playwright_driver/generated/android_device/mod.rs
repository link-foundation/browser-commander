// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod close_event;
pub mod close_params;
pub mod close_result;
pub mod connect_to_web_view_params;
pub mod connect_to_web_view_result;
pub mod drag_params;
pub mod drag_result;
pub mod fill_params;
pub mod fill_result;
pub mod fling_params;
pub mod fling_result;
pub mod info_params;
pub mod info_result;
pub mod initializer;
pub mod input_drag_params;
pub mod input_drag_result;
pub mod input_press_params;
pub mod input_press_result;
pub mod input_swipe_params;
pub mod input_swipe_result;
pub mod input_tap_params;
pub mod input_tap_result;
pub mod input_type_params;
pub mod input_type_result;
pub mod install_apk_params;
pub mod install_apk_result;
pub mod launch_browser_params;
pub mod launch_browser_result;
pub mod long_tap_params;
pub mod long_tap_result;
mod methods_0;
mod methods_1;
pub mod open_params;
pub mod open_result;
pub mod pinch_close_params;
pub mod pinch_close_result;
pub mod pinch_open_params;
pub mod pinch_open_result;
pub mod push_params;
pub mod push_result;
pub mod screenshot_params;
pub mod screenshot_result;
pub mod scroll_params;
pub mod scroll_result;
pub mod shell_params;
pub mod shell_result;
pub mod swipe_params;
pub mod swipe_result;
pub mod tap_params;
pub mod tap_result;
pub mod wait_params;
pub mod wait_result;
pub mod web_view_added_event;
pub mod web_view_removed_event;
#[derive(Clone)]
pub struct AndroidDeviceChannel(pub Channel<super::types::AndroidDevice>);
impl AndroidDeviceChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::AndroidDevice> {
        self.0.reference()
    }
}
