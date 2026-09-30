// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetGeolocationParamsGeolocation {
    #[serde(rename = "longitude")]
    pub longitude: f64,
    #[serde(rename = "latitude")]
    pub latitude: f64,
    #[serde(rename = "accuracy")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accuracy: Option<f64>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SetGeolocationParams {
    #[serde(rename = "geolocation")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub geolocation: Option<SetGeolocationParamsGeolocation>,
}
