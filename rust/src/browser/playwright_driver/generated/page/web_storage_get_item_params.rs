// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum WebStorageGetItemParamsKind {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "session")]
    Session,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WebStorageGetItemParams {
    #[serde(rename = "kind")]
    pub kind: WebStorageGetItemParamsKind,
    #[serde(rename = "name")]
    pub name: String,
}
