// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PageErrorsResult {
    #[serde(rename = "errors")]
    pub errors: Vec<Box<super::super::types::SerializedError>>,
}
