// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum LifecycleEvent {
    #[serde(rename = "load")]
    Load,
    #[serde(rename = "domcontentloaded")]
    Domcontentloaded,
    #[serde(rename = "networkidle")]
    Networkidle,
    #[serde(rename = "commit")]
    Commit,
}
