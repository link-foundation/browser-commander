// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl BrowserChannel {
    pub async fn start_server(
        &self,
        params: start_server_params::StartServerParams,
    ) -> playwright_rs::Result<start_server_result::StartServerResult> {
        self.0.call("startServer", params).await
    }
    pub async fn stop_server(
        &self,
        params: stop_server_params::StopServerParams,
    ) -> playwright_rs::Result<stop_server_result::StopServerResult> {
        self.0.call("stopServer", params).await
    }
    pub async fn close(
        &self,
        params: close_params::CloseParams,
    ) -> playwright_rs::Result<close_result::CloseResult> {
        self.0.call("close", params).await
    }
    pub async fn kill_for_tests(
        &self,
        params: kill_for_tests_params::KillForTestsParams,
    ) -> playwright_rs::Result<kill_for_tests_result::KillForTestsResult> {
        self.0.call("killForTests", params).await
    }
    pub async fn default_user_agent_for_test(
        &self,
        params: default_user_agent_for_test_params::DefaultUserAgentForTestParams,
    ) -> playwright_rs::Result<default_user_agent_for_test_result::DefaultUserAgentForTestResult>
    {
        self.0.call("defaultUserAgentForTest", params).await
    }
    pub async fn new_context(
        &self,
        params: new_context_params::NewContextParams,
    ) -> playwright_rs::Result<new_context_result::NewContextResult> {
        self.0.call("newContext", params).await
    }
    pub async fn new_context_for_reuse(
        &self,
        params: new_context_for_reuse_params::NewContextForReuseParams,
    ) -> playwright_rs::Result<new_context_for_reuse_result::NewContextForReuseResult> {
        self.0.call("newContextForReuse", params).await
    }
    pub async fn disconnect_from_reused_context(
        &self,
        params: disconnect_from_reused_context_params::DisconnectFromReusedContextParams,
    ) -> playwright_rs::Result<
        disconnect_from_reused_context_result::DisconnectFromReusedContextResult,
    > {
        self.0.call("disconnectFromReusedContext", params).await
    }
    pub async fn new_browser_cdp_session(
        &self,
        params: new_browser_cdp_session_params::NewBrowserCDPSessionParams,
    ) -> playwright_rs::Result<new_browser_cdp_session_result::NewBrowserCDPSessionResult> {
        self.0.call("newBrowserCDPSession", params).await
    }
    pub async fn start_tracing(
        &self,
        params: start_tracing_params::StartTracingParams,
    ) -> playwright_rs::Result<start_tracing_result::StartTracingResult> {
        self.0.call("startTracing", params).await
    }
    pub async fn stop_tracing(
        &self,
        params: stop_tracing_params::StopTracingParams,
    ) -> playwright_rs::Result<stop_tracing_result::StopTracingResult> {
        self.0.call("stopTracing", params).await
    }
}
