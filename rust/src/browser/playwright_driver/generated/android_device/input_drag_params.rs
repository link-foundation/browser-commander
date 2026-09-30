// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InputDragParams {
    #[serde(rename = "from")]
    pub from: Box<super::super::types::Point>,
    #[serde(rename = "to")]
    pub to: Box<super::super::types::Point>,
    #[serde(rename = "steps")]
    pub steps: i64,
}
