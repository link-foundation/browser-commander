// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ExpectedTextValue {
    #[serde(rename = "string")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub string: Option<String>,
    #[serde(rename = "regexSource")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex_source: Option<String>,
    #[serde(rename = "regexFlags")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex_flags: Option<String>,
    #[serde(rename = "matchSubstring")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_substring: Option<bool>,
    #[serde(rename = "ignoreCase")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ignore_case: Option<bool>,
    #[serde(rename = "normalizeWhiteSpace")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub normalize_white_space: Option<bool>,
}
