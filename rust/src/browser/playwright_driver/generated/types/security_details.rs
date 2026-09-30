// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SecurityDetails {
    #[serde(rename = "issuer")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    #[serde(rename = "protocol")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protocol: Option<String>,
    #[serde(rename = "subjectName")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject_name: Option<String>,
    #[serde(rename = "validFrom")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub valid_from: Option<f64>,
    #[serde(rename = "validTo")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub valid_to: Option<f64>,
}
