// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl AndroidDeviceChannel {
    pub async fn install_apk(
        &self,
        params: install_apk_params::InstallApkParams,
    ) -> playwright_rs::Result<install_apk_result::InstallApkResult> {
        self.0.call("installApk", params).await
    }
    pub async fn push(
        &self,
        params: push_params::PushParams,
    ) -> playwright_rs::Result<push_result::PushResult> {
        self.0.call("push", params).await
    }
    pub async fn connect_to_web_view(
        &self,
        params: connect_to_web_view_params::ConnectToWebViewParams,
    ) -> playwright_rs::Result<connect_to_web_view_result::ConnectToWebViewResult> {
        self.0.call("connectToWebView", params).await
    }
    pub async fn close(
        &self,
        params: close_params::CloseParams,
    ) -> playwright_rs::Result<close_result::CloseResult> {
        self.0.call("close", params).await
    }
}
