// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StopJSCoverageResultEntriesItemFunctionsItemRangesItem {
    #[serde(rename = "startOffset")]
    pub start_offset: i64,
    #[serde(rename = "endOffset")]
    pub end_offset: i64,
    #[serde(rename = "count")]
    pub count: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StopJSCoverageResultEntriesItemFunctionsItem {
    #[serde(rename = "functionName")]
    pub function_name: String,
    #[serde(rename = "isBlockCoverage")]
    pub is_block_coverage: bool,
    #[serde(rename = "ranges")]
    pub ranges: Vec<StopJSCoverageResultEntriesItemFunctionsItemRangesItem>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StopJSCoverageResultEntriesItem {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "scriptId")]
    pub script_id: String,
    #[serde(rename = "source")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(rename = "functions")]
    pub functions: Vec<StopJSCoverageResultEntriesItemFunctionsItem>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct StopJSCoverageResult {
    #[serde(rename = "entries")]
    pub entries: Vec<StopJSCoverageResultEntriesItem>,
}
