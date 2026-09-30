// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum InitializerBrowserName {
    #[serde(rename = "chromium")]
    Chromium,
    #[serde(rename = "firefox")]
    Firefox,
    #[serde(rename = "webkit")]
    Webkit,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Initializer {
    #[serde(rename = "version")]
    pub version: String,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "browserName")]
    pub browser_name: InitializerBrowserName,
}
