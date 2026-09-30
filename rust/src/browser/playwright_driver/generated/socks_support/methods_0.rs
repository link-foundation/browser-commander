// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl SocksSupportChannel {
    pub async fn socks_connected(
        &self,
        params: socks_connected_params::SocksConnectedParams,
    ) -> playwright_rs::Result<socks_connected_result::SocksConnectedResult> {
        self.0.call("socksConnected", params).await
    }
    pub async fn socks_failed(
        &self,
        params: socks_failed_params::SocksFailedParams,
    ) -> playwright_rs::Result<socks_failed_result::SocksFailedResult> {
        self.0.call("socksFailed", params).await
    }
    pub async fn socks_data(
        &self,
        params: socks_data_params::SocksDataParams,
    ) -> playwright_rs::Result<socks_data_result::SocksDataResult> {
        self.0.call("socksData", params).await
    }
    pub async fn socks_error(
        &self,
        params: socks_error_params::SocksErrorParams,
    ) -> playwright_rs::Result<socks_error_result::SocksErrorResult> {
        self.0.call("socksError", params).await
    }
    pub async fn socks_end(
        &self,
        params: socks_end_params::SocksEndParams,
    ) -> playwright_rs::Result<socks_end_result::SocksEndResult> {
        self.0.call("socksEnd", params).await
    }
}
