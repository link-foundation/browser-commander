// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LaunchOptionsProxy {
    #[serde(rename = "server")]
    pub server: String,
    #[serde(rename = "bypass")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bypass: Option<String>,
    #[serde(rename = "username")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(rename = "password")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LaunchOptions {
    #[serde(rename = "channel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
    #[serde(rename = "executablePath")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(rename = "args")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(rename = "ignoreAllDefaultArgs")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_all_default_args: Option<bool>,
    #[serde(rename = "ignoreDefaultArgs")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_default_args: Option<Vec<String>>,
    #[serde(rename = "handleSIGINT")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_sigint: Option<bool>,
    #[serde(rename = "handleSIGTERM")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_sigterm: Option<bool>,
    #[serde(rename = "handleSIGHUP")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_sighup: Option<bool>,
    #[serde(rename = "env")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "headless")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headless: Option<bool>,
    #[serde(rename = "proxy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<LaunchOptionsProxy>,
    #[serde(rename = "downloadsPath")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub downloads_path: Option<String>,
    #[serde(rename = "tracesDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traces_dir: Option<String>,
    #[serde(rename = "artifactsDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifacts_dir: Option<String>,
    #[serde(rename = "chromiumSandbox")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chromium_sandbox: Option<bool>,
    #[serde(rename = "firefoxUserPrefs")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub firefox_user_prefs: Option<serde_json::Value>,
    #[serde(rename = "cdpPort")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cdp_port: Option<i64>,
}
