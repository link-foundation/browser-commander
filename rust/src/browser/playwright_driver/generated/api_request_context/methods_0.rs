// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl APIRequestContextChannel {
    pub async fn fetch(
        &self,
        params: fetch_params::FetchParams,
    ) -> playwright_rs::Result<fetch_result::FetchResult> {
        self.0.call("fetch", params).await
    }
    pub async fn fetch_response_body(
        &self,
        params: fetch_response_body_params::FetchResponseBodyParams,
    ) -> playwright_rs::Result<fetch_response_body_result::FetchResponseBodyResult> {
        self.0.call("fetchResponseBody", params).await
    }
    pub async fn fetch_log(
        &self,
        params: fetch_log_params::FetchLogParams,
    ) -> playwright_rs::Result<fetch_log_result::FetchLogResult> {
        self.0.call("fetchLog", params).await
    }
    pub async fn storage_state(
        &self,
        params: storage_state_params::StorageStateParams,
    ) -> playwright_rs::Result<storage_state_result::StorageStateResult> {
        self.0.call("storageState", params).await
    }
    pub async fn dispose_api_response(
        &self,
        params: dispose_api_response_params::DisposeAPIResponseParams,
    ) -> playwright_rs::Result<dispose_api_response_result::DisposeAPIResponseResult> {
        self.0.call("disposeAPIResponse", params).await
    }
    pub async fn dispose(
        &self,
        params: dispose_params::DisposeParams,
    ) -> playwright_rs::Result<dispose_result::DisposeResult> {
        self.0.call("dispose", params).await
    }
}
