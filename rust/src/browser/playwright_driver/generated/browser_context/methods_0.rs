// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl BrowserContextChannel {
    pub async fn add_cookies(
        &self,
        params: add_cookies_params::AddCookiesParams,
    ) -> playwright_rs::Result<add_cookies_result::AddCookiesResult> {
        self.0.call("addCookies", params).await
    }
    pub async fn add_init_script(
        &self,
        params: add_init_script_params::AddInitScriptParams,
    ) -> playwright_rs::Result<add_init_script_result::AddInitScriptResult> {
        self.0.call("addInitScript", params).await
    }
    pub async fn clear_cookies(
        &self,
        params: clear_cookies_params::ClearCookiesParams,
    ) -> playwright_rs::Result<clear_cookies_result::ClearCookiesResult> {
        self.0.call("clearCookies", params).await
    }
    pub async fn clear_permissions(
        &self,
        params: clear_permissions_params::ClearPermissionsParams,
    ) -> playwright_rs::Result<clear_permissions_result::ClearPermissionsResult> {
        self.0.call("clearPermissions", params).await
    }
    pub async fn close(
        &self,
        params: close_params::CloseParams,
    ) -> playwright_rs::Result<close_result::CloseResult> {
        self.0.call("close", params).await
    }
    pub async fn cookies(
        &self,
        params: cookies_params::CookiesParams,
    ) -> playwright_rs::Result<cookies_result::CookiesResult> {
        self.0.call("cookies", params).await
    }
    pub async fn expose_binding(
        &self,
        params: expose_binding_params::ExposeBindingParams,
    ) -> playwright_rs::Result<expose_binding_result::ExposeBindingResult> {
        self.0.call("exposeBinding", params).await
    }
    pub async fn grant_permissions(
        &self,
        params: grant_permissions_params::GrantPermissionsParams,
    ) -> playwright_rs::Result<grant_permissions_result::GrantPermissionsResult> {
        self.0.call("grantPermissions", params).await
    }
    pub async fn new_page(
        &self,
        params: new_page_params::NewPageParams,
    ) -> playwright_rs::Result<new_page_result::NewPageResult> {
        self.0.call("newPage", params).await
    }
    pub async fn register_selector_engine(
        &self,
        params: register_selector_engine_params::RegisterSelectorEngineParams,
    ) -> playwright_rs::Result<register_selector_engine_result::RegisterSelectorEngineResult> {
        self.0.call("registerSelectorEngine", params).await
    }
    pub async fn set_test_id_attribute_name(
        &self,
        params: set_test_id_attribute_name_params::SetTestIdAttributeNameParams,
    ) -> playwright_rs::Result<set_test_id_attribute_name_result::SetTestIdAttributeNameResult>
    {
        self.0.call("setTestIdAttributeName", params).await
    }
    pub async fn set_extra_http_headers(
        &self,
        params: set_extra_http_headers_params::SetExtraHTTPHeadersParams,
    ) -> playwright_rs::Result<set_extra_http_headers_result::SetExtraHTTPHeadersResult> {
        self.0.call("setExtraHTTPHeaders", params).await
    }
    pub async fn set_geolocation(
        &self,
        params: set_geolocation_params::SetGeolocationParams,
    ) -> playwright_rs::Result<set_geolocation_result::SetGeolocationResult> {
        self.0.call("setGeolocation", params).await
    }
    pub async fn set_http_credentials(
        &self,
        params: set_http_credentials_params::SetHTTPCredentialsParams,
    ) -> playwright_rs::Result<set_http_credentials_result::SetHTTPCredentialsResult> {
        self.0.call("setHTTPCredentials", params).await
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
    pub async fn set_offline(
        &self,
        params: set_offline_params::SetOfflineParams,
    ) -> playwright_rs::Result<set_offline_result::SetOfflineResult> {
        self.0.call("setOffline", params).await
    }
    pub async fn storage_state(
        &self,
        params: storage_state_params::StorageStateParams,
    ) -> playwright_rs::Result<storage_state_result::StorageStateResult> {
        self.0.call("storageState", params).await
    }
    pub async fn set_storage_state(
        &self,
        params: set_storage_state_params::SetStorageStateParams,
    ) -> playwright_rs::Result<set_storage_state_result::SetStorageStateResult> {
        self.0.call("setStorageState", params).await
    }
    pub async fn pause(
        &self,
        params: pause_params::PauseParams,
    ) -> playwright_rs::Result<pause_result::PauseResult> {
        self.0.call("pause", params).await
    }
}
