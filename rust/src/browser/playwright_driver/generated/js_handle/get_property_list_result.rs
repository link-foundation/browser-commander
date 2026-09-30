// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GetPropertyListResultPropertiesItem {
    #[serde(rename = "name")]
    pub name: String,
    #[serde(rename = "value")]
    pub value: super::super::ChannelRef<super::super::types::JSHandle>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct GetPropertyListResult {
    #[serde(rename = "properties")]
    pub properties: Vec<GetPropertyListResultPropertiesItem>,
}
