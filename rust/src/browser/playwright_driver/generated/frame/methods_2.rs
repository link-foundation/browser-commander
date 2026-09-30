// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl FrameChannel {
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
    pub async fn title(
        &self,
        params: title_params::TitleParams,
    ) -> playwright_rs::Result<title_result::TitleResult> {
        self.0.call("title", params).await
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
    pub async fn wait_for_timeout(
        &self,
        params: wait_for_timeout_params::WaitForTimeoutParams,
    ) -> playwright_rs::Result<wait_for_timeout_result::WaitForTimeoutResult> {
        self.0.call("waitForTimeout", params).await
    }
    pub async fn wait_for_function(
        &self,
        params: wait_for_function_params::WaitForFunctionParams,
    ) -> playwright_rs::Result<wait_for_function_result::WaitForFunctionResult> {
        self.0.call("waitForFunction", params).await
    }
    pub async fn wait_for_selector(
        &self,
        params: wait_for_selector_params::WaitForSelectorParams,
    ) -> playwright_rs::Result<wait_for_selector_result::WaitForSelectorResult> {
        self.0.call("waitForSelector", params).await
    }
    pub async fn expect(
        &self,
        params: expect_params::ExpectParams,
    ) -> playwright_rs::Result<expect_result::ExpectResult> {
        self.0.call("expect", params).await
    }
}
