// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl LocalUtilsChannel {
    pub async fn zip(
        &self,
        params: zip_params::ZipParams,
    ) -> playwright_rs::Result<zip_result::ZipResult> {
        self.0.call("zip", params).await
    }
    pub async fn har_open(
        &self,
        params: har_open_params::HarOpenParams,
    ) -> playwright_rs::Result<har_open_result::HarOpenResult> {
        self.0.call("harOpen", params).await
    }
    pub async fn har_lookup(
        &self,
        params: har_lookup_params::HarLookupParams,
    ) -> playwright_rs::Result<har_lookup_result::HarLookupResult> {
        self.0.call("harLookup", params).await
    }
    pub async fn har_close(
        &self,
        params: har_close_params::HarCloseParams,
    ) -> playwright_rs::Result<har_close_result::HarCloseResult> {
        self.0.call("harClose", params).await
    }
    pub async fn har_unzip(
        &self,
        params: har_unzip_params::HarUnzipParams,
    ) -> playwright_rs::Result<har_unzip_result::HarUnzipResult> {
        self.0.call("harUnzip", params).await
    }
    pub async fn connect(
        &self,
        params: connect_params::ConnectParams,
    ) -> playwright_rs::Result<connect_result::ConnectResult> {
        self.0.call("connect", params).await
    }
    pub async fn tracing_started(
        &self,
        params: tracing_started_params::TracingStartedParams,
    ) -> playwright_rs::Result<tracing_started_result::TracingStartedResult> {
        self.0.call("tracingStarted", params).await
    }
    pub async fn add_stack_to_tracing_no_reply(
        &self,
        params: add_stack_to_tracing_no_reply_params::AddStackToTracingNoReplyParams,
    ) -> playwright_rs::Result<add_stack_to_tracing_no_reply_result::AddStackToTracingNoReplyResult>
    {
        self.0.call("addStackToTracingNoReply", params).await
    }
    pub async fn trace_discarded(
        &self,
        params: trace_discarded_params::TraceDiscardedParams,
    ) -> playwright_rs::Result<trace_discarded_result::TraceDiscardedResult> {
        self.0.call("traceDiscarded", params).await
    }
    pub async fn glob_to_regex(
        &self,
        params: glob_to_regex_params::GlobToRegexParams,
    ) -> playwright_rs::Result<glob_to_regex_result::GlobToRegexResult> {
        self.0.call("globToRegex", params).await
    }
}
