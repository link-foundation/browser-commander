// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl ElementHandleChannel {
    pub async fn eval_on_selector(
        &self,
        params: eval_on_selector_params::EvalOnSelectorParams,
    ) -> playwright_rs::Result<eval_on_selector_result::EvalOnSelectorResult> {
        self.0.call("evalOnSelector", params).await
    }
    pub async fn eval_on_selector_all(
        &self,
        params: eval_on_selector_all_params::EvalOnSelectorAllParams,
    ) -> playwright_rs::Result<eval_on_selector_all_result::EvalOnSelectorAllResult> {
        self.0.call("evalOnSelectorAll", params).await
    }
    pub async fn bounding_box(
        &self,
        params: bounding_box_params::BoundingBoxParams,
    ) -> playwright_rs::Result<bounding_box_result::BoundingBoxResult> {
        self.0.call("boundingBox", params).await
    }
    pub async fn check(
        &self,
        params: check_params::CheckParams,
    ) -> playwright_rs::Result<check_result::CheckResult> {
        self.0.call("check", params).await
    }
    pub async fn click(
        &self,
        params: click_params::ClickParams,
    ) -> playwright_rs::Result<click_result::ClickResult> {
        self.0.call("click", params).await
    }
    pub async fn content_frame(
        &self,
        params: content_frame_params::ContentFrameParams,
    ) -> playwright_rs::Result<content_frame_result::ContentFrameResult> {
        self.0.call("contentFrame", params).await
    }
    pub async fn dblclick(
        &self,
        params: dblclick_params::DblclickParams,
    ) -> playwright_rs::Result<dblclick_result::DblclickResult> {
        self.0.call("dblclick", params).await
    }
    pub async fn dispatch_event(
        &self,
        params: dispatch_event_params::DispatchEventParams,
    ) -> playwright_rs::Result<dispatch_event_result::DispatchEventResult> {
        self.0.call("dispatchEvent", params).await
    }
    pub async fn fill(
        &self,
        params: fill_params::FillParams,
    ) -> playwright_rs::Result<fill_result::FillResult> {
        self.0.call("fill", params).await
    }
    pub async fn focus(
        &self,
        params: focus_params::FocusParams,
    ) -> playwright_rs::Result<focus_result::FocusResult> {
        self.0.call("focus", params).await
    }
    pub async fn get_attribute(
        &self,
        params: get_attribute_params::GetAttributeParams,
    ) -> playwright_rs::Result<get_attribute_result::GetAttributeResult> {
        self.0.call("getAttribute", params).await
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
    pub async fn is_editable(
        &self,
        params: is_editable_params::IsEditableParams,
    ) -> playwright_rs::Result<is_editable_result::IsEditableResult> {
        self.0.call("isEditable", params).await
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
}
