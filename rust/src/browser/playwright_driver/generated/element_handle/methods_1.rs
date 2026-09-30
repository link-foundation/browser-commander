// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl ElementHandleChannel {
    pub async fn is_visible(
        &self,
        params: is_visible_params::IsVisibleParams,
    ) -> playwright_rs::Result<is_visible_result::IsVisibleResult> {
        self.0.call("isVisible", params).await
    }
    pub async fn owner_frame(
        &self,
        params: owner_frame_params::OwnerFrameParams,
    ) -> playwright_rs::Result<owner_frame_result::OwnerFrameResult> {
        self.0.call("ownerFrame", params).await
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
    pub async fn screenshot(
        &self,
        params: screenshot_params::ScreenshotParams,
    ) -> playwright_rs::Result<screenshot_result::ScreenshotResult> {
        self.0.call("screenshot", params).await
    }
    pub async fn scroll_into_view_if_needed(
        &self,
        params: scroll_into_view_if_needed_params::ScrollIntoViewIfNeededParams,
    ) -> playwright_rs::Result<scroll_into_view_if_needed_result::ScrollIntoViewIfNeededResult>
    {
        self.0.call("scrollIntoViewIfNeeded", params).await
    }
    pub async fn select_option(
        &self,
        params: select_option_params::SelectOptionParams,
    ) -> playwright_rs::Result<select_option_result::SelectOptionResult> {
        self.0.call("selectOption", params).await
    }
    pub async fn select_text(
        &self,
        params: select_text_params::SelectTextParams,
    ) -> playwright_rs::Result<select_text_result::SelectTextResult> {
        self.0.call("selectText", params).await
    }
    pub async fn set_input_files(
        &self,
        params: set_input_files_params::SetInputFilesParams,
    ) -> playwright_rs::Result<set_input_files_result::SetInputFilesResult> {
        self.0.call("setInputFiles", params).await
    }
    pub async fn tap(
        &self,
        params: tap_params::TapParams,
    ) -> playwright_rs::Result<tap_result::TapResult> {
        self.0.call("tap", params).await
    }
    pub async fn text_content(
        &self,
        params: text_content_params::TextContentParams,
    ) -> playwright_rs::Result<text_content_result::TextContentResult> {
        self.0.call("textContent", params).await
    }
    pub async fn r#type(
        &self,
        params: type_params::TypeParams,
    ) -> playwright_rs::Result<type_result::TypeResult> {
        self.0.call("type", params).await
    }
    pub async fn uncheck(
        &self,
        params: uncheck_params::UncheckParams,
    ) -> playwright_rs::Result<uncheck_result::UncheckResult> {
        self.0.call("uncheck", params).await
    }
    pub async fn wait_for_element_state(
        &self,
        params: wait_for_element_state_params::WaitForElementStateParams,
    ) -> playwright_rs::Result<wait_for_element_state_result::WaitForElementStateResult> {
        self.0.call("waitForElementState", params).await
    }
    pub async fn wait_for_selector(
        &self,
        params: wait_for_selector_params::WaitForSelectorParams,
    ) -> playwright_rs::Result<wait_for_selector_result::WaitForSelectorResult> {
        self.0.call("waitForSelector", params).await
    }
}
