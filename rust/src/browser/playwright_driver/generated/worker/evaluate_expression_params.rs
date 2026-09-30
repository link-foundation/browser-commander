// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct EvaluateExpressionParams {
    #[serde(rename = "expression")]
    pub expression: String,
    #[serde(rename = "isFunction")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_function: Option<bool>,
    #[serde(rename = "arg")]
    pub arg: Box<super::super::types::SerializedArgument>,
}
