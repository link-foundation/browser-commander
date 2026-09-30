// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
use super::*;
impl BrowserContextChannel {
    pub async fn enable_recorder(
        &self,
        params: enable_recorder_params::EnableRecorderParams,
    ) -> playwright_rs::Result<enable_recorder_result::EnableRecorderResult> {
        self.0.call("enableRecorder", params).await
    }
    pub async fn disable_recorder(
        &self,
        params: disable_recorder_params::DisableRecorderParams,
    ) -> playwright_rs::Result<disable_recorder_result::DisableRecorderResult> {
        self.0.call("disableRecorder", params).await
    }
    pub async fn expose_console_api(
        &self,
        params: expose_console_api_params::ExposeConsoleApiParams,
    ) -> playwright_rs::Result<expose_console_api_result::ExposeConsoleApiResult> {
        self.0.call("exposeConsoleApi", params).await
    }
    pub async fn new_cdp_session(
        &self,
        params: new_cdp_session_params::NewCDPSessionParams,
    ) -> playwright_rs::Result<new_cdp_session_result::NewCDPSessionResult> {
        self.0.call("newCDPSession", params).await
    }
    pub async fn create_temp_files(
        &self,
        params: create_temp_files_params::CreateTempFilesParams,
    ) -> playwright_rs::Result<create_temp_files_result::CreateTempFilesResult> {
        self.0.call("createTempFiles", params).await
    }
    pub async fn update_subscription(
        &self,
        params: update_subscription_params::UpdateSubscriptionParams,
    ) -> playwright_rs::Result<update_subscription_result::UpdateSubscriptionResult> {
        self.0.call("updateSubscription", params).await
    }
    pub async fn clock_fast_forward(
        &self,
        params: clock_fast_forward_params::ClockFastForwardParams,
    ) -> playwright_rs::Result<clock_fast_forward_result::ClockFastForwardResult> {
        self.0.call("clockFastForward", params).await
    }
    pub async fn clock_install(
        &self,
        params: clock_install_params::ClockInstallParams,
    ) -> playwright_rs::Result<clock_install_result::ClockInstallResult> {
        self.0.call("clockInstall", params).await
    }
    pub async fn clock_pause_at(
        &self,
        params: clock_pause_at_params::ClockPauseAtParams,
    ) -> playwright_rs::Result<clock_pause_at_result::ClockPauseAtResult> {
        self.0.call("clockPauseAt", params).await
    }
    pub async fn clock_resume(
        &self,
        params: clock_resume_params::ClockResumeParams,
    ) -> playwright_rs::Result<clock_resume_result::ClockResumeResult> {
        self.0.call("clockResume", params).await
    }
    pub async fn clock_run_for(
        &self,
        params: clock_run_for_params::ClockRunForParams,
    ) -> playwright_rs::Result<clock_run_for_result::ClockRunForResult> {
        self.0.call("clockRunFor", params).await
    }
    pub async fn clock_set_fixed_time(
        &self,
        params: clock_set_fixed_time_params::ClockSetFixedTimeParams,
    ) -> playwright_rs::Result<clock_set_fixed_time_result::ClockSetFixedTimeResult> {
        self.0.call("clockSetFixedTime", params).await
    }
    pub async fn clock_set_system_time(
        &self,
        params: clock_set_system_time_params::ClockSetSystemTimeParams,
    ) -> playwright_rs::Result<clock_set_system_time_result::ClockSetSystemTimeResult> {
        self.0.call("clockSetSystemTime", params).await
    }
    pub async fn credentials_install(
        &self,
        params: credentials_install_params::CredentialsInstallParams,
    ) -> playwright_rs::Result<credentials_install_result::CredentialsInstallResult> {
        self.0.call("credentialsInstall", params).await
    }
    pub async fn credentials_create(
        &self,
        params: credentials_create_params::CredentialsCreateParams,
    ) -> playwright_rs::Result<credentials_create_result::CredentialsCreateResult> {
        self.0.call("credentialsCreate", params).await
    }
    pub async fn credentials_get(
        &self,
        params: credentials_get_params::CredentialsGetParams,
    ) -> playwright_rs::Result<credentials_get_result::CredentialsGetResult> {
        self.0.call("credentialsGet", params).await
    }
    pub async fn credentials_delete(
        &self,
        params: credentials_delete_params::CredentialsDeleteParams,
    ) -> playwright_rs::Result<credentials_delete_result::CredentialsDeleteResult> {
        self.0.call("credentialsDelete", params).await
    }
}
