// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InputSwipeParams {
    #[serde(rename = "segments")]
    pub segments: Vec<Box<super::super::types::Point>>,
    #[serde(rename = "steps")]
    pub steps: i64,
}
