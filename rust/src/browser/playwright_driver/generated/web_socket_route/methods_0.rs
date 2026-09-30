// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl WebSocketRouteChannel {
    pub async fn connect(
        &self,
        params: connect_params::ConnectParams,
    ) -> playwright_rs::Result<connect_result::ConnectResult> {
        self.0.call("connect", params).await
    }
    pub async fn ensure_opened(
        &self,
        params: ensure_opened_params::EnsureOpenedParams,
    ) -> playwright_rs::Result<ensure_opened_result::EnsureOpenedResult> {
        self.0.call("ensureOpened", params).await
    }
    pub async fn send_to_page(
        &self,
        params: send_to_page_params::SendToPageParams,
    ) -> playwright_rs::Result<send_to_page_result::SendToPageResult> {
        self.0.call("sendToPage", params).await
    }
    pub async fn send_to_server(
        &self,
        params: send_to_server_params::SendToServerParams,
    ) -> playwright_rs::Result<send_to_server_result::SendToServerResult> {
        self.0.call("sendToServer", params).await
    }
    pub async fn close_page(
        &self,
        params: close_page_params::ClosePageParams,
    ) -> playwright_rs::Result<close_page_result::ClosePageResult> {
        self.0.call("closePage", params).await
    }
    pub async fn close_server(
        &self,
        params: close_server_params::CloseServerParams,
    ) -> playwright_rs::Result<close_server_result::CloseServerResult> {
        self.0.call("closeServer", params).await
    }
}
