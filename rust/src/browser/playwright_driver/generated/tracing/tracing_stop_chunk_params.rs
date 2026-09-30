// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum TracingStopChunkParamsMode {
    #[serde(rename = "archive")]
    Archive,
    #[serde(rename = "discard")]
    Discard,
    #[serde(rename = "entries")]
    Entries,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TracingStopChunkParams {
    #[serde(rename = "mode")]
    pub mode: TracingStopChunkParamsMode,
}
