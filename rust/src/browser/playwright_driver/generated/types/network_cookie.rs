// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum NetworkCookieSameSite {
    #[serde(rename = "Strict")]
    Strict,
    #[serde(rename = "Lax")]
    Lax,
    #[serde(rename = "None")]
    None,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct NetworkCookie {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "value")]
    pub value: String,
    #[serde(rename = "domain")]
    pub domain: String,
    #[serde(rename = "path")]
    pub path: String,
    #[serde(rename = "expires")]
    pub expires: f64,
    #[serde(rename = "httpOnly")]
    pub http_only: bool,
    #[serde(rename = "secure")]
    pub secure: bool,
    #[serde(rename = "sameSite")]
    pub same_site: NetworkCookieSameSite,
    #[serde(rename = "partitionKey")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partition_key: Option<String>,
    #[serde(rename = "_crHasCrossSiteAncestor")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub _cr_has_cross_site_ancestor: Option<bool>,
}
