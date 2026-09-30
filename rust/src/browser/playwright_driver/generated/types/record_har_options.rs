// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum RecordHarOptionsContent {
    #[serde(rename = "embed")]
    Embed,
    #[serde(rename = "attach")]
    Attach,
    #[serde(rename = "omit")]
    Omit,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum RecordHarOptionsMode {
    #[serde(rename = "full")]
    Full,
    #[serde(rename = "minimal")]
    Minimal,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct RecordHarOptions {
    #[serde(rename = "content")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<RecordHarOptionsContent>,
    #[serde(rename = "mode")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<RecordHarOptionsMode>,
    #[serde(rename = "urlGlob")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_glob: Option<String>,
    #[serde(rename = "urlRegexSource")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_regex_source: Option<String>,
    #[serde(rename = "urlRegexFlags")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_regex_flags: Option<String>,
    #[serde(rename = "harPath")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub har_path: Option<String>,
    #[serde(rename = "resourcesDir")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resources_dir: Option<String>,
}
