// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl BindingCallChannel {
    pub async fn reject(
        &self,
        params: reject_params::RejectParams,
    ) -> playwright_rs::Result<reject_result::RejectResult> {
        self.0.call("reject", params).await
    }
    pub async fn resolve(
        &self,
        params: resolve_params::ResolveParams,
    ) -> playwright_rs::Result<resolve_result::ResolveResult> {
        self.0.call("resolve", params).await
    }
}
