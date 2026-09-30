// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TracingStartParams {
    #[serde(rename = "name")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(rename = "snapshotDom")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_dom: Option<bool>,
    #[serde(rename = "snapshotAria")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_aria: Option<bool>,
    #[serde(rename = "snapshotScreen")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_screen: Option<bool>,
    #[serde(rename = "screencast")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screencast: Option<bool>,
    #[serde(rename = "live")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub live: Option<bool>,
}
