// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::super::Channel;
pub mod add_script_tag_params;
pub mod add_script_tag_result;
pub mod add_style_tag_params;
pub mod add_style_tag_result;
pub mod aria_snapshot_json_params;
pub mod aria_snapshot_json_result;
pub mod aria_snapshot_params;
pub mod aria_snapshot_result;
pub mod blur_params;
pub mod blur_result;
pub mod check_params;
pub mod check_result;
pub mod click_params;
pub mod click_result;
pub mod content_params;
pub mod content_result;
pub mod dblclick_params;
pub mod dblclick_result;
pub mod dispatch_event_params;
pub mod dispatch_event_result;
pub mod drag_and_drop_params;
pub mod drag_and_drop_result;
pub mod drop_params;
pub mod drop_result;
pub mod eval_on_selector_all_params;
pub mod eval_on_selector_all_result;
pub mod eval_on_selector_params;
pub mod eval_on_selector_result;
pub mod evaluate_expression_handle_params;
pub mod evaluate_expression_handle_result;
pub mod evaluate_expression_params;
pub mod evaluate_expression_result;
pub mod expect_params;
pub mod expect_result;
pub mod fill_params;
pub mod fill_result;
pub mod focus_params;
pub mod focus_result;
pub mod frame_element_params;
pub mod frame_element_result;
pub mod get_attribute_params;
pub mod get_attribute_result;
pub mod goto_params;
pub mod goto_result;
pub mod hide_highlight_params;
pub mod hide_highlight_result;
pub mod highlight_params;
pub mod highlight_result;
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
pub mod loadstate_event;
mod methods_0;
mod methods_1;
mod methods_2;
pub mod navigated_event;
pub mod press_params;
pub mod press_result;
pub mod query_count_params;
pub mod query_count_result;
pub mod query_selector_all_params;
pub mod query_selector_all_result;
pub mod query_selector_params;
pub mod query_selector_result;
pub mod resolve_selector_params;
pub mod resolve_selector_result;
pub mod select_option_params;
pub mod select_option_result;
pub mod set_content_params;
pub mod set_content_result;
pub mod set_input_files_params;
pub mod set_input_files_result;
pub mod tap_params;
pub mod tap_result;
pub mod text_content_params;
pub mod text_content_result;
pub mod title_params;
pub mod title_result;
pub mod type_params;
pub mod type_result;
pub mod uncheck_params;
pub mod uncheck_result;
pub mod wait_for_function_params;
pub mod wait_for_function_result;
pub mod wait_for_selector_params;
pub mod wait_for_selector_result;
pub mod wait_for_timeout_params;
pub mod wait_for_timeout_result;
#[derive(Clone)]
pub struct FrameChannel(pub Channel<super::types::Frame>);
impl FrameChannel {
    pub fn new(
        connection: std::sync::Arc<playwright_rs::server::connection::Connection>,
        guid: impl Into<String>,
    ) -> Self {
        Self(Channel::new(connection, guid.into()))
    }
    pub fn reference(&self) -> super::super::ChannelRef<super::types::Frame> {
        self.0.reference()
    }
}
