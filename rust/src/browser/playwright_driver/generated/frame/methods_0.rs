// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl FrameChannel {
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
    pub async fn add_script_tag(
        &self,
        params: add_script_tag_params::AddScriptTagParams,
    ) -> playwright_rs::Result<add_script_tag_result::AddScriptTagResult> {
        self.0.call("addScriptTag", params).await
    }
    pub async fn add_style_tag(
        &self,
        params: add_style_tag_params::AddStyleTagParams,
    ) -> playwright_rs::Result<add_style_tag_result::AddStyleTagResult> {
        self.0.call("addStyleTag", params).await
    }
    pub async fn aria_snapshot(
        &self,
        params: aria_snapshot_params::AriaSnapshotParams,
    ) -> playwright_rs::Result<aria_snapshot_result::AriaSnapshotResult> {
        self.0.call("ariaSnapshot", params).await
    }
    pub async fn aria_snapshot_json(
        &self,
        params: aria_snapshot_json_params::AriaSnapshotJSONParams,
    ) -> playwright_rs::Result<aria_snapshot_json_result::AriaSnapshotJSONResult> {
        self.0.call("ariaSnapshotJSON", params).await
    }
    pub async fn blur(
        &self,
        params: blur_params::BlurParams,
    ) -> playwright_rs::Result<blur_result::BlurResult> {
        self.0.call("blur", params).await
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
    pub async fn content(
        &self,
        params: content_params::ContentParams,
    ) -> playwright_rs::Result<content_result::ContentResult> {
        self.0.call("content", params).await
    }
    pub async fn drag_and_drop(
        &self,
        params: drag_and_drop_params::DragAndDropParams,
    ) -> playwright_rs::Result<drag_and_drop_result::DragAndDropResult> {
        self.0.call("dragAndDrop", params).await
    }
    pub async fn drop(
        &self,
        params: drop_params::DropParams,
    ) -> playwright_rs::Result<drop_result::DropResult> {
        self.0.call("drop", params).await
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
    pub async fn evaluate_expression(
        &self,
        params: evaluate_expression_params::EvaluateExpressionParams,
    ) -> playwright_rs::Result<evaluate_expression_result::EvaluateExpressionResult> {
        self.0.call("evaluateExpression", params).await
    }
    pub async fn evaluate_expression_handle(
        &self,
        params: evaluate_expression_handle_params::EvaluateExpressionHandleParams,
    ) -> playwright_rs::Result<evaluate_expression_handle_result::EvaluateExpressionHandleResult>
    {
        self.0.call("evaluateExpressionHandle", params).await
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
    pub async fn frame_element(
        &self,
        params: frame_element_params::FrameElementParams,
    ) -> playwright_rs::Result<frame_element_result::FrameElementResult> {
        self.0.call("frameElement", params).await
    }
    pub async fn resolve_selector(
        &self,
        params: resolve_selector_params::ResolveSelectorParams,
    ) -> playwright_rs::Result<resolve_selector_result::ResolveSelectorResult> {
        self.0.call("resolveSelector", params).await
    }
}
