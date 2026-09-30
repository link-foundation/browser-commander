// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl RouteChannel {
    pub async fn redirect_navigation_request(
        &self,
        params: redirect_navigation_request_params::RedirectNavigationRequestParams,
    ) -> playwright_rs::Result<redirect_navigation_request_result::RedirectNavigationRequestResult>
    {
        self.0.call("redirectNavigationRequest", params).await
    }
    pub async fn abort(
        &self,
        params: abort_params::AbortParams,
    ) -> playwright_rs::Result<abort_result::AbortResult> {
        self.0.call("abort", params).await
    }
    pub async fn r#continue(
        &self,
        params: continue_params::ContinueParams,
    ) -> playwright_rs::Result<continue_result::ContinueResult> {
        self.0.call("continue", params).await
    }
    pub async fn fulfill(
        &self,
        params: fulfill_params::FulfillParams,
    ) -> playwright_rs::Result<fulfill_result::FulfillResult> {
        self.0.call("fulfill", params).await
    }
}
