// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ClearCookiesParams {
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "nameRegexSource")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_regex_source: Option<String>,
    #[serde(rename = "nameRegexFlags")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name_regex_flags: Option<String>,
    #[serde(rename = "domain")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(rename = "domainRegexSource")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_regex_source: Option<String>,
    #[serde(rename = "domainRegexFlags")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain_regex_flags: Option<String>,
    #[serde(rename = "path")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(rename = "pathRegexSource")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_regex_source: Option<String>,
    #[serde(rename = "pathRegexFlags")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path_regex_flags: Option<String>,
}
