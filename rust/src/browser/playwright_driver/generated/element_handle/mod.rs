// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod bounding_box_params;
pub mod bounding_box_result;
pub mod check_params;
pub mod check_result;
pub mod click_params;
pub mod click_result;
pub mod content_frame_params;
pub mod content_frame_result;
pub mod dblclick_params;
pub mod dblclick_result;
pub mod dispatch_event_params;
pub mod dispatch_event_result;
pub mod eval_on_selector_all_params;
pub mod eval_on_selector_all_result;
pub mod eval_on_selector_params;
pub mod eval_on_selector_result;
pub mod fill_params;
pub mod fill_result;
pub mod focus_params;
pub mod focus_result;
pub mod get_attribute_params;
pub mod get_attribute_result;
pub mod hover_params;
pub mod hover_result;
pub mod initializer;
pub mod inner_html_params;
pub mod inner_html_result;
pub mod inner_text_params;
pub mod inner_text_result;
pub mod input_value_params;
pub mod input_value_result;
pub mod is_checked_params;
pub mod is_checked_result;
pub mod is_disabled_params;
pub mod is_disabled_result;
pub mod is_editable_params;
pub mod is_editable_result;
pub mod is_enabled_params;
pub mod is_enabled_result;
pub mod is_hidden_params;
pub mod is_hidden_result;
pub mod is_visible_params;
pub mod is_visible_result;
mod methods_0;
mod methods_1;
pub mod owner_frame_params;
pub mod owner_frame_result;
pub mod press_params;
pub mod press_result;
pub mod query_selector_all_params;
pub mod query_selector_all_result;
pub mod query_selector_params;
pub mod query_selector_result;
pub mod screenshot_params;
pub mod screenshot_result;
pub mod scroll_into_view_if_needed_params;
pub mod scroll_into_view_if_needed_result;
pub mod select_option_params;
pub mod select_option_result;
pub mod select_text_params;
pub mod select_text_result;
pub mod set_input_files_params;
pub mod set_input_files_result;
pub mod tap_params;
pub mod tap_result;
pub mod text_content_params;
pub mod text_content_result;
pub mod type_params;
pub mod type_result;
pub mod uncheck_params;
pub mod uncheck_result;
pub mod wait_for_element_state_params;
pub mod wait_for_element_state_result;
pub mod wait_for_selector_params;
pub mod wait_for_selector_result;
#[derive(Clone)]
pub struct ElementHandleChannel(pub Channel<super::types::ElementHandle>);
impl ElementHandleChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::ElementHandle> {
        self.0.reference()
    }
    pub fn as_js_handle(&self) -> super::js_handle::JSHandleChannel {
        super::js_handle::JSHandleChannel::new(self.0.connection(), self.0.reference().guid.clone())
    }
}
