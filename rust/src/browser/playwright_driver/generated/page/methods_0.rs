// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl PageChannel {
    pub async fn add_init_script(
        &self,
        params: add_init_script_params::AddInitScriptParams,
    ) -> playwright_rs::Result<add_init_script_result::AddInitScriptResult> {
        self.0.call("addInitScript", params).await
    }
    pub async fn close(
        &self,
        params: close_params::CloseParams,
    ) -> playwright_rs::Result<close_result::CloseResult> {
        self.0.call("close", params).await
    }
    pub async fn run_before_unload(
        &self,
        params: run_before_unload_params::RunBeforeUnloadParams,
    ) -> playwright_rs::Result<run_before_unload_result::RunBeforeUnloadResult> {
        self.0.call("runBeforeUnload", params).await
    }
    pub async fn clear_console_messages(
        &self,
        params: clear_console_messages_params::ClearConsoleMessagesParams,
    ) -> playwright_rs::Result<clear_console_messages_result::ClearConsoleMessagesResult> {
        self.0.call("clearConsoleMessages", params).await
    }
    pub async fn console_messages(
        &self,
        params: console_messages_params::ConsoleMessagesParams,
    ) -> playwright_rs::Result<console_messages_result::ConsoleMessagesResult> {
        self.0.call("consoleMessages", params).await
    }
    pub async fn emulate_media(
        &self,
        params: emulate_media_params::EmulateMediaParams,
    ) -> playwright_rs::Result<emulate_media_result::EmulateMediaResult> {
        self.0.call("emulateMedia", params).await
    }
    pub async fn expose_binding(
        &self,
        params: expose_binding_params::ExposeBindingParams,
    ) -> playwright_rs::Result<expose_binding_result::ExposeBindingResult> {
        self.0.call("exposeBinding", params).await
    }
    pub async fn go_back(
        &self,
        params: go_back_params::GoBackParams,
    ) -> playwright_rs::Result<go_back_result::GoBackResult> {
        self.0.call("goBack", params).await
    }
    pub async fn go_forward(
        &self,
        params: go_forward_params::GoForwardParams,
    ) -> playwright_rs::Result<go_forward_result::GoForwardResult> {
        self.0.call("goForward", params).await
    }
    pub async fn request_gc(
        &self,
        params: request_gc_params::RequestGCParams,
    ) -> playwright_rs::Result<request_gc_result::RequestGCResult> {
        self.0.call("requestGC", params).await
    }
    pub async fn register_locator_handler(
        &self,
        params: register_locator_handler_params::RegisterLocatorHandlerParams,
    ) -> playwright_rs::Result<register_locator_handler_result::RegisterLocatorHandlerResult> {
        self.0.call("registerLocatorHandler", params).await
    }
    pub async fn resolve_locator_handler_no_reply(
        &self,
        params: resolve_locator_handler_no_reply_params::ResolveLocatorHandlerNoReplyParams,
    ) -> playwright_rs::Result<
        resolve_locator_handler_no_reply_result::ResolveLocatorHandlerNoReplyResult,
    > {
        self.0.call("resolveLocatorHandlerNoReply", params).await
    }
    pub async fn unregister_locator_handler(
        &self,
        params: unregister_locator_handler_params::UnregisterLocatorHandlerParams,
    ) -> playwright_rs::Result<unregister_locator_handler_result::UnregisterLocatorHandlerResult>
    {
        self.0.call("unregisterLocatorHandler", params).await
    }
    pub async fn reload(
        &self,
        params: reload_params::ReloadParams,
    ) -> playwright_rs::Result<reload_result::ReloadResult> {
        self.0.call("reload", params).await
    }
    pub async fn expect_screenshot(
        &self,
        params: expect_screenshot_params::ExpectScreenshotParams,
    ) -> playwright_rs::Result<expect_screenshot_result::ExpectScreenshotResult> {
        self.0.call("expectScreenshot", params).await
    }
    pub async fn screenshot(
        &self,
        params: screenshot_params::ScreenshotParams,
    ) -> playwright_rs::Result<screenshot_result::ScreenshotResult> {
        self.0.call("screenshot", params).await
    }
    pub async fn set_extra_http_headers(
        &self,
        params: set_extra_http_headers_params::SetExtraHTTPHeadersParams,
    ) -> playwright_rs::Result<set_extra_http_headers_result::SetExtraHTTPHeadersResult> {
        self.0.call("setExtraHTTPHeaders", params).await
    }
    pub async fn set_network_interception_patterns(
        &self,
        params: set_network_interception_patterns_params::SetNetworkInterceptionPatternsParams,
    ) -> playwright_rs::Result<
        set_network_interception_patterns_result::SetNetworkInterceptionPatternsResult,
    > {
        self.0.call("setNetworkInterceptionPatterns", params).await
    }
    pub async fn set_web_socket_interception_patterns(
        &self,
        params: set_web_socket_interception_patterns_params::SetWebSocketInterceptionPatternsParams,
    ) -> playwright_rs::Result<
        set_web_socket_interception_patterns_result::SetWebSocketInterceptionPatternsResult,
    > {
        self.0
            .call("setWebSocketInterceptionPatterns", params)
            .await
    }
    pub async fn set_viewport_size(
        &self,
        params: set_viewport_size_params::SetViewportSizeParams,
    ) -> playwright_rs::Result<set_viewport_size_result::SetViewportSizeResult> {
        self.0.call("setViewportSize", params).await
    }
}
