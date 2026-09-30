// Generated from Playwright 1.63.0 protocol YAML. Do not edit.
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EmulateMediaParamsMedia {
    #[serde(rename = "screen")]
    Screen,
    #[serde(rename = "print")]
    Print,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EmulateMediaParamsColorScheme {
    #[serde(rename = "dark")]
    Dark,
    #[serde(rename = "light")]
    Light,
    #[serde(rename = "no-preference")]
    NoPreference,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EmulateMediaParamsReducedMotion {
    #[serde(rename = "reduce")]
    Reduce,
    #[serde(rename = "no-preference")]
    NoPreference,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EmulateMediaParamsForcedColors {
    #[serde(rename = "active")]
    Active,
    #[serde(rename = "none")]
    None,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum EmulateMediaParamsContrast {
    #[serde(rename = "no-preference")]
    NoPreference,
    #[serde(rename = "more")]
    More,
    #[serde(rename = "no-override")]
    NoOverride,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct EmulateMediaParams {
    #[serde(rename = "media")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media: Option<EmulateMediaParamsMedia>,
    #[serde(rename = "colorScheme")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color_scheme: Option<EmulateMediaParamsColorScheme>,
    #[serde(rename = "reducedMotion")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reduced_motion: Option<EmulateMediaParamsReducedMotion>,
    #[serde(rename = "forcedColors")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forced_colors: Option<EmulateMediaParamsForcedColors>,
    #[serde(rename = "contrast")]
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contrast: Option<EmulateMediaParamsContrast>,
}
