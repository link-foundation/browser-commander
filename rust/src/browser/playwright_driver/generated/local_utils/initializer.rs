// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InitializerDeviceDescriptorsItemDescriptorViewport {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InitializerDeviceDescriptorsItemDescriptorScreen {
    #[serde(rename = "width")]
    pub width: i64,
    #[serde(rename = "height")]
    pub height: i64,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum InitializerDeviceDescriptorsItemDescriptorDefaultBrowserType {
    #[serde(rename = "chromium")]
    Chromium,
    #[serde(rename = "firefox")]
    Firefox,
    #[serde(rename = "webkit")]
    Webkit,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InitializerDeviceDescriptorsItemDescriptor {
    #[serde(rename = "userAgent")]
    pub user_agent: String,
    #[serde(rename = "viewport")]
    pub viewport: InitializerDeviceDescriptorsItemDescriptorViewport,
    #[serde(rename = "screen")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen: Option<InitializerDeviceDescriptorsItemDescriptorScreen>,
    #[serde(rename = "deviceScaleFactor")]
    pub device_scale_factor: f64,
    #[serde(rename = "isMobile")]
    pub is_mobile: bool,
    #[serde(rename = "hasTouch")]
    pub has_touch: bool,
    #[serde(rename = "defaultBrowserType")]
    pub default_browser_type: InitializerDeviceDescriptorsItemDescriptorDefaultBrowserType,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InitializerDeviceDescriptorsItem {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "descriptor")]
    pub descriptor: InitializerDeviceDescriptorsItemDescriptor,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "deviceDescriptors")]
    pub device_descriptors: Vec<InitializerDeviceDescriptorsItem>,
}
