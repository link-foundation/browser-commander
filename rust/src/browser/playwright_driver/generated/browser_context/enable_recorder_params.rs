// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EnableRecorderParamsMode {
    #[serde(rename = "inspecting")]
    Inspecting,
    #[serde(rename = "recording")]
    Recording,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EnableRecorderParamsRecorderMode {
    #[serde(rename = "default")]
    Default,
    #[serde(rename = "api")]
    Api,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct EnableRecorderParams {
    #[serde(rename = "language")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(rename = "mode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<EnableRecorderParamsMode>,
    #[serde(rename = "recorderMode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recorder_mode: Option<EnableRecorderParamsRecorderMode>,
    #[serde(rename = "pauseOnNextStatement")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause_on_next_statement: Option<bool>,
    #[serde(rename = "testIdAttributeName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub test_id_attribute_name: Option<String>,
    #[serde(rename = "launchOptions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch_options: Option<serde_json::Value>,
    #[serde(rename = "contextOptions")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_options: Option<serde_json::Value>,
    #[serde(rename = "device")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    #[serde(rename = "saveStorage")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save_storage: Option<String>,
    #[serde(rename = "outputFile")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_file: Option<String>,
    #[serde(rename = "handleSIGINT")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle_sigint: Option<bool>,
    #[serde(rename = "omitCallTracking")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omit_call_tracking: Option<bool>,
}
