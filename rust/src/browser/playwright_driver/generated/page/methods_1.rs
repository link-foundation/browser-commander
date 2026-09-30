// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl PageChannel {
    pub async fn keyboard_down(
        &self,
        params: keyboard_down_params::KeyboardDownParams,
    ) -> playwright_rs::Result<keyboard_down_result::KeyboardDownResult> {
        self.0.call("keyboardDown", params).await
    }
    pub async fn keyboard_up(
        &self,
        params: keyboard_up_params::KeyboardUpParams,
    ) -> playwright_rs::Result<keyboard_up_result::KeyboardUpResult> {
        self.0.call("keyboardUp", params).await
    }
    pub async fn keyboard_insert_text(
        &self,
        params: keyboard_insert_text_params::KeyboardInsertTextParams,
    ) -> playwright_rs::Result<keyboard_insert_text_result::KeyboardInsertTextResult> {
        self.0.call("keyboardInsertText", params).await
    }
    pub async fn keyboard_type(
        &self,
        params: keyboard_type_params::KeyboardTypeParams,
    ) -> playwright_rs::Result<keyboard_type_result::KeyboardTypeResult> {
        self.0.call("keyboardType", params).await
    }
    pub async fn keyboard_press(
        &self,
        params: keyboard_press_params::KeyboardPressParams,
    ) -> playwright_rs::Result<keyboard_press_result::KeyboardPressResult> {
        self.0.call("keyboardPress", params).await
    }
    pub async fn mouse_move(
        &self,
        params: mouse_move_params::MouseMoveParams,
    ) -> playwright_rs::Result<mouse_move_result::MouseMoveResult> {
        self.0.call("mouseMove", params).await
    }
    pub async fn mouse_down(
        &self,
        params: mouse_down_params::MouseDownParams,
    ) -> playwright_rs::Result<mouse_down_result::MouseDownResult> {
        self.0.call("mouseDown", params).await
    }
    pub async fn mouse_up(
        &self,
        params: mouse_up_params::MouseUpParams,
    ) -> playwright_rs::Result<mouse_up_result::MouseUpResult> {
        self.0.call("mouseUp", params).await
    }
    pub async fn mouse_click(
        &self,
        params: mouse_click_params::MouseClickParams,
    ) -> playwright_rs::Result<mouse_click_result::MouseClickResult> {
        self.0.call("mouseClick", params).await
    }
    pub async fn mouse_wheel(
        &self,
        params: mouse_wheel_params::MouseWheelParams,
    ) -> playwright_rs::Result<mouse_wheel_result::MouseWheelResult> {
        self.0.call("mouseWheel", params).await
    }
    pub async fn touchscreen_tap(
        &self,
        params: touchscreen_tap_params::TouchscreenTapParams,
    ) -> playwright_rs::Result<touchscreen_tap_result::TouchscreenTapResult> {
        self.0.call("touchscreenTap", params).await
    }
    pub async fn clear_page_errors(
        &self,
        params: clear_page_errors_params::ClearPageErrorsParams,
    ) -> playwright_rs::Result<clear_page_errors_result::ClearPageErrorsResult> {
        self.0.call("clearPageErrors", params).await
    }
    pub async fn page_errors(
        &self,
        params: page_errors_params::PageErrorsParams,
    ) -> playwright_rs::Result<page_errors_result::PageErrorsResult> {
        self.0.call("pageErrors", params).await
    }
    pub async fn pdf(
        &self,
        params: pdf_params::PdfParams,
    ) -> playwright_rs::Result<pdf_result::PdfResult> {
        self.0.call("pdf", params).await
    }
    pub async fn requests(
        &self,
        params: requests_params::RequestsParams,
    ) -> playwright_rs::Result<requests_result::RequestsResult> {
        self.0.call("requests", params).await
    }
    pub async fn start_js_coverage(
        &self,
        params: start_js_coverage_params::StartJSCoverageParams,
    ) -> playwright_rs::Result<start_js_coverage_result::StartJSCoverageResult> {
        self.0.call("startJSCoverage", params).await
    }
    pub async fn stop_js_coverage(
        &self,
        params: stop_js_coverage_params::StopJSCoverageParams,
    ) -> playwright_rs::Result<stop_js_coverage_result::StopJSCoverageResult> {
        self.0.call("stopJSCoverage", params).await
    }
    pub async fn start_css_coverage(
        &self,
        params: start_css_coverage_params::StartCSSCoverageParams,
    ) -> playwright_rs::Result<start_css_coverage_result::StartCSSCoverageResult> {
        self.0.call("startCSSCoverage", params).await
    }
    pub async fn stop_css_coverage(
        &self,
        params: stop_css_coverage_params::StopCSSCoverageParams,
    ) -> playwright_rs::Result<stop_css_coverage_result::StopCSSCoverageResult> {
        self.0.call("stopCSSCoverage", params).await
    }
    pub async fn bring_to_front(
        &self,
        params: bring_to_front_params::BringToFrontParams,
    ) -> playwright_rs::Result<bring_to_front_result::BringToFrontResult> {
        self.0.call("bringToFront", params).await
    }
}
