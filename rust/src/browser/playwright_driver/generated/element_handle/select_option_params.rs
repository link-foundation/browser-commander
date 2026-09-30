// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SelectOptionParamsOptionsItem {
    #[serde(rename = "valueOrLabel")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value_or_label: Option<String>,
    #[serde(rename = "value")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    #[serde(rename = "label")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(rename = "index")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<i64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SelectOptionParams {
    #[serde(rename = "elements")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elements: Option<Vec<super::super::ChannelRef<super::super::types::ElementHandle>>>,
    #[serde(rename = "options")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<SelectOptionParamsOptionsItem>>,
    #[serde(rename = "force")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub force: Option<bool>,
}
