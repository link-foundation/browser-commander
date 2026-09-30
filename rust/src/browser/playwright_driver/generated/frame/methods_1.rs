// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl FrameChannel {
    pub async fn highlight(
        &self,
        params: highlight_params::HighlightParams,
    ) -> playwright_rs::Result<highlight_result::HighlightResult> {
        self.0.call("highlight", params).await
    }
    pub async fn hide_highlight(
        &self,
        params: hide_highlight_params::HideHighlightParams,
    ) -> playwright_rs::Result<hide_highlight_result::HideHighlightResult> {
        self.0.call("hideHighlight", params).await
    }
    pub async fn get_attribute(
        &self,
        params: get_attribute_params::GetAttributeParams,
    ) -> playwright_rs::Result<get_attribute_result::GetAttributeResult> {
        self.0.call("getAttribute", params).await
    }
    pub async fn goto(
        &self,
        params: goto_params::GotoParams,
    ) -> playwright_rs::Result<goto_result::GotoResult> {
        self.0.call("goto", params).await
    }
    pub async fn hover(
        &self,
        params: hover_params::HoverParams,
    ) -> playwright_rs::Result<hover_result::HoverResult> {
        self.0.call("hover", params).await
    }
    pub async fn inner_html(
        &self,
        params: inner_html_params::InnerHTMLParams,
    ) -> playwright_rs::Result<inner_html_result::InnerHTMLResult> {
        self.0.call("innerHTML", params).await
    }
    pub async fn inner_text(
        &self,
        params: inner_text_params::InnerTextParams,
    ) -> playwright_rs::Result<inner_text_result::InnerTextResult> {
        self.0.call("innerText", params).await
    }
    pub async fn input_value(
        &self,
        params: input_value_params::InputValueParams,
    ) -> playwright_rs::Result<input_value_result::InputValueResult> {
        self.0.call("inputValue", params).await
    }
    pub async fn is_checked(
        &self,
        params: is_checked_params::IsCheckedParams,
    ) -> playwright_rs::Result<is_checked_result::IsCheckedResult> {
        self.0.call("isChecked", params).await
    }
    pub async fn is_disabled(
        &self,
        params: is_disabled_params::IsDisabledParams,
    ) -> playwright_rs::Result<is_disabled_result::IsDisabledResult> {
        self.0.call("isDisabled", params).await
    }
    pub async fn is_enabled(
        &self,
        params: is_enabled_params::IsEnabledParams,
    ) -> playwright_rs::Result<is_enabled_result::IsEnabledResult> {
        self.0.call("isEnabled", params).await
    }
    pub async fn is_hidden(
        &self,
        params: is_hidden_params::IsHiddenParams,
    ) -> playwright_rs::Result<is_hidden_result::IsHiddenResult> {
        self.0.call("isHidden", params).await
    }
    pub async fn is_visible(
        &self,
        params: is_visible_params::IsVisibleParams,
    ) -> playwright_rs::Result<is_visible_result::IsVisibleResult> {
        self.0.call("isVisible", params).await
    }
    pub async fn is_editable(
        &self,
        params: is_editable_params::IsEditableParams,
    ) -> playwright_rs::Result<is_editable_result::IsEditableResult> {
        self.0.call("isEditable", params).await
    }
    pub async fn press(
        &self,
        params: press_params::PressParams,
    ) -> playwright_rs::Result<press_result::PressResult> {
        self.0.call("press", params).await
    }
    pub async fn query_selector(
        &self,
        params: query_selector_params::QuerySelectorParams,
    ) -> playwright_rs::Result<query_selector_result::QuerySelectorResult> {
        self.0.call("querySelector", params).await
    }
    pub async fn query_selector_all(
        &self,
        params: query_selector_all_params::QuerySelectorAllParams,
    ) -> playwright_rs::Result<query_selector_all_result::QuerySelectorAllResult> {
        self.0.call("querySelectorAll", params).await
    }
    pub async fn query_count(
        &self,
        params: query_count_params::QueryCountParams,
    ) -> playwright_rs::Result<query_count_result::QueryCountResult> {
        self.0.call("queryCount", params).await
    }
    pub async fn select_option(
        &self,
        params: select_option_params::SelectOptionParams,
    ) -> playwright_rs::Result<select_option_result::SelectOptionResult> {
        self.0.call("selectOption", params).await
    }
    pub async fn set_content(
        &self,
        params: set_content_params::SetContentParams,
    ) -> playwright_rs::Result<set_content_result::SetContentResult> {
        self.0.call("setContent", params).await
    }
}
