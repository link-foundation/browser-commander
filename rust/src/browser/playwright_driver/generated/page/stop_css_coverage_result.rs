// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StopCSSCoverageResultEntriesItemRangesItem {
    #[serde(rename = "start")]
    pub start: i64,
    #[serde(rename = "end")]
    pub end: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StopCSSCoverageResultEntriesItem {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "text")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(rename = "ranges")]
    pub ranges: Vec<StopCSSCoverageResultEntriesItemRangesItem>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StopCSSCoverageResult {
    #[serde(rename = "entries")]
    pub entries: Vec<StopCSSCoverageResultEntriesItem>,
}
