// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetNetworkInterceptionPatternsParamsPatternsItem {
    #[serde(rename = "glob")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    #[serde(rename = "regexSource")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex_source: Option<String>,
    #[serde(rename = "regexFlags")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex_flags: Option<String>,
    #[serde(rename = "urlPattern")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_pattern: Option<Box<super::super::types::URLPattern>>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetNetworkInterceptionPatternsParams {
    #[serde(rename = "patterns")]
    pub patterns: Vec<SetNetworkInterceptionPatternsParamsPatternsItem>,
}
