// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum ExpectParamsPseudo {
    #[serde(rename = "before")]
    Before,
    #[serde(rename = "after")]
    After,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ExpectParams {
    #[serde(rename = "selector")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(rename = "expression")]
    pub expression: String,
    #[serde(rename = "expressionArg")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expression_arg: Option<serde_json::Value>,
    #[serde(rename = "pseudo")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pseudo: Option<ExpectParamsPseudo>,
    #[serde(rename = "expectedText")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_text: Option<Vec<Box<super::super::types::ExpectedTextValue>>>,
    #[serde(rename = "expectedNumber")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_number: Option<f64>,
    #[serde(rename = "expectedValue")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_value: Option<Box<super::super::types::SerializedArgument>>,
    #[serde(rename = "useInnerText")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub use_inner_text: Option<bool>,
    #[serde(rename = "isNot")]
    pub is_not: bool,
}
