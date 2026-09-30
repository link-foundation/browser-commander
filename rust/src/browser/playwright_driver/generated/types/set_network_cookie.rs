// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SetNetworkCookieSameSite {
    #[serde(rename = "Strict")]
    Strict,
    #[serde(rename = "Lax")]
    Lax,
    #[serde(rename = "None")]
    None,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetNetworkCookie {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "value")]
    pub value: String,
    #[serde(rename = "url")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(rename = "domain")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(rename = "path")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(rename = "expires")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires: Option<f64>,
    #[serde(rename = "httpOnly")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_only: Option<bool>,
    #[serde(rename = "secure")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secure: Option<bool>,
    #[serde(rename = "sameSite")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub same_site: Option<SetNetworkCookieSameSite>,
    #[serde(rename = "partitionKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partition_key: Option<String>,
    #[serde(rename = "_crHasCrossSiteAncestor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub _cr_has_cross_site_ancestor: Option<bool>,
}
