// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ResourceTiming {
    #[serde(rename = "startTime")]
    pub start_time: f64,
    #[serde(rename = "domainLookupStart")]
    pub domain_lookup_start: f64,
    #[serde(rename = "domainLookupEnd")]
    pub domain_lookup_end: f64,
    #[serde(rename = "connectStart")]
    pub connect_start: f64,
    #[serde(rename = "secureConnectionStart")]
    pub secure_connection_start: f64,
    #[serde(rename = "connectEnd")]
    pub connect_end: f64,
    #[serde(rename = "requestStart")]
    pub request_start: f64,
    #[serde(rename = "responseStart")]
    pub response_start: f64,
}
