// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConsoleEventLocation {
    #[serde(rename = "url")]
    pub url: String,
    #[serde(rename = "lineNumber")]
    pub line_number: i64,
    #[serde(rename = "columnNumber")]
    pub column_number: i64,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ConsoleEvent {
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(rename = "text")]
    pub text: String,
    #[serde(rename = "args")]
    pub args: Vec<super::super::ChannelRef<super::super::types::JSHandle>>,
    #[serde(rename = "location")]
    pub location: ConsoleEventLocation,
    #[serde(rename = "timestamp")]
    pub timestamp: f64,
}
