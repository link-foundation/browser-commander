// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct InspectRequestedEvent {
    #[serde(rename = "selector")]
    pub selector: String,
    #[serde(rename = "locator")]
    pub locator: String,
    #[serde(rename = "ariaSnapshot")]
    pub aria_snapshot: String,
}
