// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum HarLookupResultAction {
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "redirect")]
    Redirect,
    #[serde(rename = "fulfill")]
    Fulfill,
    #[serde(rename = "noentry")]
    Noentry,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct HarLookupResult {
    #[serde(rename = "action")]
    pub action: HarLookupResultAction,
    #[serde(rename = "message")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(rename = "redirectURL")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect_url: Option<String>,
    #[serde(rename = "status")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(rename = "headers")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<Box<super::super::types::NameValue>>>,
    #[serde(rename = "body")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}
