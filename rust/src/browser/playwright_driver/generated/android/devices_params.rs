// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct DevicesParams {
    #[serde(rename = "host")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    #[serde(rename = "port")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<i64>,
    #[serde(rename = "omitDriverInstall")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omit_driver_install: Option<bool>,
}
