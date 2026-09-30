// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl BrowserTypeChannel {
    pub async fn launch(
        &self,
        params: launch_params::LaunchParams,
    ) -> playwright_rs::Result<launch_result::LaunchResult> {
        self.0.call("launch", params).await
    }
    pub async fn launch_persistent_context(
        &self,
        params: launch_persistent_context_params::LaunchPersistentContextParams,
    ) -> playwright_rs::Result<launch_persistent_context_result::LaunchPersistentContextResult>
    {
        self.0.call("launchPersistentContext", params).await
    }
    pub async fn connect_over_cdp(
        &self,
        params: connect_over_cdp_params::ConnectOverCDPParams,
    ) -> playwright_rs::Result<connect_over_cdp_result::ConnectOverCDPResult> {
        self.0.call("connectOverCDP", params).await
    }
    pub async fn connect_to_worker(
        &self,
        params: connect_to_worker_params::ConnectToWorkerParams,
    ) -> playwright_rs::Result<connect_to_worker_result::ConnectToWorkerResult> {
        self.0.call("connectToWorker", params).await
    }
}
