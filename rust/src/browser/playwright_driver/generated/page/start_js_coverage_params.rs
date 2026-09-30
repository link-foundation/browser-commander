// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StartJSCoverageParams {
    #[serde(rename = "resetOnNavigation")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset_on_navigation: Option<bool>,
    #[serde(rename = "reportAnonymousScripts")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_anonymous_scripts: Option<bool>,
}
