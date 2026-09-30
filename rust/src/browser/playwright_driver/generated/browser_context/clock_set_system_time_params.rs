// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ClockSetSystemTimeParams {
    #[serde(rename = "timeNumber")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_number: Option<f64>,
    #[serde(rename = "timeString")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_string: Option<String>,
}
