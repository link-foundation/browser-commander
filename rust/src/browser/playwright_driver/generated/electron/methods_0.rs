// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl ElectronChannel {
    pub async fn launch(
        &self,
        params: launch_params::LaunchParams,
    ) -> playwright_rs::Result<launch_result::LaunchResult> {
        self.0.call("launch", params).await
    }
}
