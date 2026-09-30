// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum WebStorageSetItemParamsKind {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "session")]
    Session,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WebStorageSetItemParams {
    #[serde(rename = "kind")]
    pub kind: WebStorageSetItemParamsKind,
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "value")]
    pub value: String,
}
