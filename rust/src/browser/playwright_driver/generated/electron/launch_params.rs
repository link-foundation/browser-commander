// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LaunchParamsAcceptDownloads {
    #[serde(rename = "accept")]
    Accept,
    #[serde(rename = "deny")]
    Deny,
    #[serde(rename = "internal-browser-default")]
    InternalBrowserDefault,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LaunchParamsColorScheme {
    #[serde(rename = "dark")]
    Dark,
    #[serde(rename = "light")]
    Light,
    #[serde(rename = "no-preference")]
    NoPreference,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LaunchParamsGeolocation {
    #[serde(rename = "longitude")]
    pub longitude: f64,
    #[serde(rename = "latitude")]
    pub latitude: f64,
    #[serde(rename = "accuracy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accuracy: Option<f64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LaunchParamsRecordVideoSize {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LaunchParamsRecordVideoShowActionsPosition {
    #[serde(rename = "top-left")]
    TopLeft,
    #[serde(rename = "top")]
    Top,
    #[serde(rename = "top-right")]
    TopRight,
    #[serde(rename = "bottom-left")]
    BottomLeft,
    #[serde(rename = "bottom")]
    Bottom,
    #[serde(rename = "bottom-right")]
    BottomRight,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LaunchParamsRecordVideoShowActionsCursor {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "pointer")]
    Pointer,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LaunchParamsRecordVideoShowActions {
    #[serde(rename = "duration")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(rename = "position")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<LaunchParamsRecordVideoShowActionsPosition>,
    #[serde(rename = "fontSize")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<i64>,
    #[serde(rename = "cursor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<LaunchParamsRecordVideoShowActionsCursor>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LaunchParamsRecordVideo {
    #[serde(rename = "dir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
    #[serde(rename = "size")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<LaunchParamsRecordVideoSize>,
    #[serde(rename = "showActions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_actions: Option<LaunchParamsRecordVideoShowActions>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct LaunchParams {
    #[serde(rename = "executablePath")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    #[serde(rename = "args")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<String>>,
    #[serde(rename = "chromiumSandbox")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chromium_sandbox: Option<bool>,
    #[serde(rename = "cwd")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(rename = "env")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub env: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "acceptDownloads")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accept_downloads: Option<LaunchParamsAcceptDownloads>,
    #[serde(rename = "bypassCSP")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bypass_csp: Option<bool>,
    #[serde(rename = "colorScheme")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_scheme: Option<LaunchParamsColorScheme>,
    #[serde(rename = "extraHTTPHeaders")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_http_headers: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "geolocation")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geolocation: Option<LaunchParamsGeolocation>,
    #[serde(rename = "httpCredentials")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_credentials: Option<Vec<Box<super::super::types::HttpCredentials>>>,
    #[serde(rename = "ignoreHTTPSErrors")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_https_errors: Option<bool>,
    #[serde(rename = "locale")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(rename = "offline")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offline: Option<bool>,
    #[serde(rename = "recordVideo")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_video: Option<LaunchParamsRecordVideo>,
    #[serde(rename = "strictSelectors")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict_selectors: Option<bool>,
    #[serde(rename = "timezoneId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone_id: Option<String>,
    #[serde(rename = "tracesDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traces_dir: Option<String>,
    #[serde(rename = "artifactsDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artifacts_dir: Option<String>,
    #[serde(rename = "selectorEngines")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector_engines: Option<Vec<Box<super::super::types::SelectorEngine>>>,
    #[serde(rename = "testIdAttributeName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_id_attribute_name: Option<String>,
}
