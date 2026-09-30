// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum WebStorageItemsParamsKind {
    #[serde(rename = "local")]
    Local,
    #[serde(rename = "session")]
    Session,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct WebStorageItemsParams {
    #[serde(rename = "kind")]
    pub kind: WebStorageItemsParamsKind,
}
