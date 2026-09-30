// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SetRecorderModeParamsMode {
    #[serde(rename = "inspecting")]
    Inspecting,
    #[serde(rename = "recording")]
    Recording,
    #[serde(rename = "none")]
    None,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetRecorderModeParams {
    #[serde(rename = "mode")]
    pub mode: SetRecorderModeParamsMode,
    #[serde(rename = "testIdAttributeName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_id_attribute_name: Option<String>,
    #[serde(rename = "generateAutoExpect")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub generate_auto_expect: Option<bool>,
}
