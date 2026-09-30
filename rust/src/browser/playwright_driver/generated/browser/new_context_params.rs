// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParamsViewport {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParamsScreen {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParamsClientCertificatesItem {
    #[serde(rename = "origin")]
    pub origin: String,
    #[serde(rename = "cert")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert: Option<String>,
    #[serde(rename = "key")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(rename = "passphrase")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
    #[serde(rename = "pfx")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pfx: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParamsGeolocation {
    #[serde(rename = "longitude")]
    pub longitude: f64,
    #[serde(rename = "latitude")]
    pub latitude: f64,
    #[serde(rename = "accuracy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accuracy: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NewContextParamsColorScheme {
    #[serde(rename = "dark")]
    Dark,
    #[serde(rename = "light")]
    Light,
    #[serde(rename = "no-preference")]
    NoPreference,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NewContextParamsReducedMotion {
    #[serde(rename = "reduce")]
    Reduce,
    #[serde(rename = "no-preference")]
    NoPreference,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NewContextParamsForcedColors {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "none")]
    None,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NewContextParamsAcceptDownloads {
    #[serde(rename = "accept")]
    Accept,
    #[serde(rename = "deny")]
    Deny,
    #[serde(rename = "internal-browser-default")]
    InternalBrowserDefault,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NewContextParamsContrast {
    #[serde(rename = "no-preference")]
    NoPreference,
    #[serde(rename = "more")]
    More,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParamsRecordVideoSize {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NewContextParamsRecordVideoShowActionsPosition {
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
pub enum NewContextParamsRecordVideoShowActionsCursor {
    #[serde(rename = "none")]
    None,
    #[serde(rename = "pointer")]
    Pointer,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParamsRecordVideoShowActions {
    #[serde(rename = "duration")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
    #[serde(rename = "position")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<NewContextParamsRecordVideoShowActionsPosition>,
    #[serde(rename = "fontSize")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<i64>,
    #[serde(rename = "cursor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<NewContextParamsRecordVideoShowActionsCursor>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParamsRecordVideo {
    #[serde(rename = "dir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
    #[serde(rename = "size")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<NewContextParamsRecordVideoSize>,
    #[serde(rename = "showActions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_actions: Option<NewContextParamsRecordVideoShowActions>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NewContextParamsServiceWorkers {
    #[serde(rename = "allow")]
    Allow,
    #[serde(rename = "block")]
    Block,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParamsProxy {
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
pub struct NewContextParamsStorageState {
    #[serde(rename = "cookies")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookies: Option<Vec<Box<super::super::types::SetNetworkCookie>>>,
    #[serde(rename = "origins")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origins: Option<Vec<Box<super::super::types::SetOriginStorage>>>,
    #[serde(rename = "credentials")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credentials: Option<Vec<Box<super::super::types::VirtualCredential>>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NewContextParams {
    #[serde(rename = "noDefaultViewport")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_default_viewport: Option<bool>,
    #[serde(rename = "viewport")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport: Option<NewContextParamsViewport>,
    #[serde(rename = "screen")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen: Option<NewContextParamsScreen>,
    #[serde(rename = "ignoreHTTPSErrors")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_https_errors: Option<bool>,
    #[serde(rename = "clientCertificates")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_certificates: Option<Vec<NewContextParamsClientCertificatesItem>>,
    #[serde(rename = "javaScriptEnabled")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub java_script_enabled: Option<bool>,
    #[serde(rename = "bypassCSP")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bypass_csp: Option<bool>,
    #[serde(rename = "userAgent")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    #[serde(rename = "locale")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(rename = "timezoneId")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timezone_id: Option<String>,
    #[serde(rename = "geolocation")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geolocation: Option<NewContextParamsGeolocation>,
    #[serde(rename = "permissions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permissions: Option<Vec<String>>,
    #[serde(rename = "extraHTTPHeaders")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extra_http_headers: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "offline")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offline: Option<bool>,
    #[serde(rename = "httpCredentials")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_credentials: Option<Vec<Box<super::super::types::HttpCredentials>>>,
    #[serde(rename = "deviceScaleFactor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_scale_factor: Option<f64>,
    #[serde(rename = "isMobile")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_mobile: Option<bool>,
    #[serde(rename = "hasTouch")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_touch: Option<bool>,
    #[serde(rename = "colorScheme")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_scheme: Option<NewContextParamsColorScheme>,
    #[serde(rename = "reducedMotion")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduced_motion: Option<NewContextParamsReducedMotion>,
    #[serde(rename = "forcedColors")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forced_colors: Option<NewContextParamsForcedColors>,
    #[serde(rename = "acceptDownloads")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accept_downloads: Option<NewContextParamsAcceptDownloads>,
    #[serde(rename = "contrast")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contrast: Option<NewContextParamsContrast>,
    #[serde(rename = "baseURL")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(rename = "recordVideo")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_video: Option<NewContextParamsRecordVideo>,
    #[serde(rename = "strictSelectors")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict_selectors: Option<bool>,
    #[serde(rename = "serviceWorkers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_workers: Option<NewContextParamsServiceWorkers>,
    #[serde(rename = "selectorEngines")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector_engines: Option<Vec<Box<super::super::types::SelectorEngine>>>,
    #[serde(rename = "testIdAttributeName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_id_attribute_name: Option<String>,
    #[serde(rename = "proxy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub proxy: Option<NewContextParamsProxy>,
    #[serde(rename = "storageState")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_state: Option<NewContextParamsStorageState>,
}
