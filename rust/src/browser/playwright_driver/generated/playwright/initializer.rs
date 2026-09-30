// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "chromium")]
    pub chromium: super::super::ChannelRef<super::super::types::BrowserType>,
    #[serde(rename = "firefox")]
    pub firefox: super::super::ChannelRef<super::super::types::BrowserType>,
    #[serde(rename = "webkit")]
    pub webkit: super::super::ChannelRef<super::super::types::BrowserType>,
    #[serde(rename = "android")]
    pub android: super::super::ChannelRef<super::super::types::Android>,
    #[serde(rename = "electron")]
    pub electron: super::super::ChannelRef<super::super::types::Electron>,
    #[serde(rename = "utils")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub utils: Option<super::super::ChannelRef<super::super::types::LocalUtils>>,
    #[serde(rename = "preLaunchedBrowser")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_launched_browser: Option<super::super::ChannelRef<super::super::types::Browser>>,
    #[serde(rename = "preConnectedAndroidDevice")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pre_connected_android_device:
        Option<super::super::ChannelRef<super::super::types::AndroidDevice>>,
    #[serde(rename = "socksSupport")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub socks_support: Option<super::super::ChannelRef<super::super::types::SocksSupport>>,
}
