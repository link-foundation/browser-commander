//! Normalization and validation of fingerprint profiles.
//!
//! A fingerprint profile is the complete description of the environment a page
//! is allowed to see: who the browser claims to be, where it claims to run, and
//! what hardware it claims to have.
//!
//! Every field here is applied through a documented mechanism -- a Chrome
//! switch, a CDP `Emulation` command, or a page init script -- and the
//! mechanism is recorded in [`FINGERPRINT_FIELD_MECHANISMS`] so callers can
//! tell an override the browser enforces from an override that is only a
//! JavaScript patch. See `docs/case-studies/issue-79` for the surfaces that
//! have no mechanism at all.
//!
//! The structs serialize to the camelCase field names the Chrome DevTools
//! Protocol uses, so a profile can go straight into a CDP payload without a
//! second vocabulary in between. This is the Rust side of
//! `js/src/fingerprint/profile.js` and
//! `python/src/browser_commander/fingerprint/profile.py`; the unit tests are
//! translations of each other.

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use super::derive::derive_user_agent_data;

/// One entry of a User-Agent Client Hints brand list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrandVersion {
    /// Brand name, for example `Google Chrome`.
    pub brand: String,
    /// Version string, major only in `brands` and full in `fullVersionList`.
    pub version: String,
}

/// The User-Agent Client Hints a page can read through `navigator.userAgentData`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct UserAgentData {
    /// Low-entropy brand list, sent on every request.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brands: Option<Vec<BrandVersion>>,
    /// High-entropy brand list with full version numbers.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_version_list: Option<Vec<BrandVersion>>,
    /// Platform hint, for example `Windows`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// Platform version hint; on Windows this is the only real version signal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform_version: Option<String>,
    /// CPU architecture hint, for example `x86`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub architecture: Option<String>,
    /// CPU bitness hint, for example `64`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bitness: Option<String>,
    /// Deprecated in the protocol but still the only way to control the
    /// `uaFullVersion` high-entropy hint: with `fullVersionList` alone the page
    /// still reads the real Chrome build number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_version: Option<String>,
    /// Device model, non-empty only on mobile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Whether the browser reports itself as mobile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mobile: Option<bool>,
    /// Whether a 32-bit browser is running on 64-bit Windows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wow64: Option<bool>,
    /// Form factor hints, for example `["Desktop"]`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub form_factors: Option<Vec<String>>,
}

/// The screen a page believes the browser window lives on.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct ScreenProfile {
    /// `screen.width` in CSS pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// `screen.height` in CSS pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// `screen.availWidth`, the width left after system chrome.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avail_width: Option<u32>,
    /// `screen.availHeight`, the height left after system chrome.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avail_height: Option<u32>,
    /// `screen.colorDepth` in bits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_depth: Option<u32>,
    /// `screen.pixelDepth` in bits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pixel_depth: Option<u32>,
}

/// The viewport the renderer lays the page out in.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct ViewportProfile {
    /// Layout width in CSS pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    /// Layout height in CSS pixels.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u32>,
    /// Device pixel ratio.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_scale_factor: Option<f64>,
    /// Whether the renderer emulates a mobile device.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mobile: Option<bool>,
}

/// The position the geolocation API reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeolocationProfile {
    /// Latitude in degrees, between -90 and 90.
    pub latitude: f64,
    /// Longitude in degrees, between -180 and 180.
    pub longitude: f64,
    /// Accuracy radius in metres.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accuracy: Option<f64>,
}

/// The strings the WebGL debug renderer extension reports.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct WebglProfile {
    /// `VENDOR`, which real Chrome always reports as `WebKit`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    /// `RENDERER`, which real Chrome always reports as `WebKit WebGL`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renderer: Option<String>,
    /// `UNMASKED_VENDOR_WEBGL`, the real GPU vendor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unmasked_vendor: Option<String>,
    /// `UNMASKED_RENDERER_WEBGL`, the real GPU and driver.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unmasked_renderer: Option<String>,
}

/// The `prefers-color-scheme` media feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColorScheme {
    /// `prefers-color-scheme: light`.
    Light,
    /// `prefers-color-scheme: dark`.
    Dark,
    /// No preference expressed.
    NoPreference,
}

/// The `prefers-reduced-motion` media feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReducedMotion {
    /// `prefers-reduced-motion: reduce`.
    Reduce,
    /// No preference expressed.
    NoPreference,
}

/// The `forced-colors` media feature.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ForcedColors {
    /// `forced-colors: active`.
    Active,
    /// `forced-colors: none`.
    None,
}

/// How a profile field reaches the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldMechanism {
    /// Chrome itself produces the value, so it holds for the document, for HTTP
    /// headers and for any code that reads it, and a page cannot detect the
    /// override by comparing two ways of asking.
    Browser,
    /// The value is a JavaScript property patch installed before page scripts
    /// run, which is weaker: it holds for the main world but is not what the
    /// network stack or a fresh renderer would say.
    Script,
}

/// How each profile field reaches the page.
///
/// Neither kind reaches a worker in full. Measured in a dedicated worker,
/// `userAgent`, `timezoneId` and `locale` follow the profile while `platform`,
/// `languages` and `hardwareConcurrency` revert to the host values; see
/// `docs/case-studies/issue-79/analysis-artifacts/worker-visibility.json`.
pub const FINGERPRINT_FIELD_MECHANISMS: &[(&str, FieldMechanism)] = &[
    ("userAgent", FieldMechanism::Browser),
    ("userAgentData", FieldMechanism::Browser),
    ("acceptLanguage", FieldMechanism::Browser),
    ("languages", FieldMechanism::Browser),
    ("locale", FieldMechanism::Browser),
    ("timezoneId", FieldMechanism::Browser),
    ("hardwareConcurrency", FieldMechanism::Browser),
    ("screen", FieldMechanism::Browser),
    ("viewport", FieldMechanism::Browser),
    ("maxTouchPoints", FieldMechanism::Browser),
    ("geolocation", FieldMechanism::Browser),
    ("colorScheme", FieldMechanism::Browser),
    ("reducedMotion", FieldMechanism::Browser),
    ("forcedColors", FieldMechanism::Browser),
    ("platform", FieldMechanism::Browser),
    ("vendor", FieldMechanism::Script),
    ("deviceMemory", FieldMechanism::Script),
    ("doNotTrack", FieldMechanism::Script),
    ("webgl", FieldMechanism::Script),
];

/// Look up how a profile field reaches the page.
pub fn fingerprint_field_mechanism(field: &str) -> Option<FieldMechanism> {
    FINGERPRINT_FIELD_MECHANISMS
        .iter()
        .find(|(name, _)| *name == field)
        .map(|(_, mechanism)| *mechanism)
}

/// The complete description of the environment a page is allowed to see.
///
/// Every field is optional and an unset field is left alone: the profile
/// describes what to override, never what to default to.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub struct FingerprintProfile {
    /// The full User-Agent string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent: Option<String>,
    /// Client hints; derived from `user_agent` when left unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_agent_data: Option<UserAgentData>,
    /// The `Accept-Language` list; derived from `languages` when left unset.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accept_language: Option<String>,
    /// `navigator.languages`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub languages: Option<Vec<String>>,
    /// The ICU locale used for formatting.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    /// IANA time zone identifier, for example `Europe/Berlin`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone_id: Option<String>,
    /// `navigator.platform`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    /// `navigator.vendor`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    /// `navigator.hardwareConcurrency`, the reported core count.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hardware_concurrency: Option<u32>,
    /// `navigator.deviceMemory` in gigabytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_memory: Option<f64>,
    /// `navigator.maxTouchPoints`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_touch_points: Option<u32>,
    /// `navigator.doNotTrack`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub do_not_track: Option<String>,
    /// The screen the page believes it is on.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screen: Option<ScreenProfile>,
    /// The viewport the renderer lays the page out in.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<ViewportProfile>,
    /// The strings the WebGL debug renderer extension reports.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webgl: Option<WebglProfile>,
    /// The position the geolocation API reports.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geolocation: Option<GeolocationProfile>,
    /// The `prefers-color-scheme` media feature.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_scheme: Option<ColorScheme>,
    /// The `prefers-reduced-motion` media feature.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reduced_motion: Option<ReducedMotion>,
    /// The `forced-colors` media feature.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forced_colors: Option<ForcedColors>,
}

fn positive_integer(value: Option<u32>, name: &str) -> Result<Option<u32>> {
    if value == Some(0) {
        bail!("{name} must be a positive integer");
    }
    Ok(value)
}

fn positive_number(value: Option<f64>, name: &str) -> Result<Option<f64>> {
    if let Some(number) = value {
        if !number.is_finite() || number <= 0.0 {
            bail!("{name} must be a positive number");
        }
    }
    Ok(value)
}

fn validate_screen(screen: &ScreenProfile) -> Result<()> {
    positive_integer(screen.width, "screen.width")?;
    positive_integer(screen.height, "screen.height")?;
    positive_integer(screen.avail_width, "screen.availWidth")?;
    positive_integer(screen.avail_height, "screen.availHeight")?;
    positive_integer(screen.color_depth, "screen.colorDepth")?;
    positive_integer(screen.pixel_depth, "screen.pixelDepth")?;
    if screen.width.is_none() != screen.height.is_none() {
        bail!("screen.width and screen.height must be provided together");
    }
    Ok(())
}

fn validate_viewport(viewport: &ViewportProfile) -> Result<()> {
    positive_integer(viewport.width, "viewport.width")?;
    positive_integer(viewport.height, "viewport.height")?;
    positive_number(viewport.device_scale_factor, "viewport.deviceScaleFactor")?;
    if viewport.width.is_none() != viewport.height.is_none() {
        bail!("viewport.width and viewport.height must be provided together");
    }
    Ok(())
}

fn validate_geolocation(geolocation: &GeolocationProfile) -> Result<()> {
    for (value, name) in [
        (geolocation.latitude, "geolocation.latitude"),
        (geolocation.longitude, "geolocation.longitude"),
    ] {
        if !value.is_finite() {
            bail!("{name} must be a finite number");
        }
    }
    if !(-90.0..=90.0).contains(&geolocation.latitude) {
        bail!("geolocation.latitude must be between -90 and 90");
    }
    if !(-180.0..=180.0).contains(&geolocation.longitude) {
        bail!("geolocation.longitude must be between -180 and 180");
    }
    positive_number(geolocation.accuracy, "geolocation.accuracy")?;
    Ok(())
}

/// Reject the q-value form Chrome misparses.
///
/// Chrome derives both the `Accept-Language` header and `navigator.languages`
/// from this one string, and it splits on commas without stripping q-values.
/// Passing `de-DE,de;q=0.9` therefore yields the language tag `"de;q=0.9"` and
/// the header `de-DE,de;q=0.9;q=0.9`; passing the plain list `de-DE,de,en`
/// yields correct tags and the header `de-DE,de;q=0.9,en;q=0.8` that a real
/// browser sends. Measured in
/// `docs/case-studies/issue-79/analysis-artifacts/ua-hints-detail.json`.
fn validate_accept_language(accept_language: &str) -> Result<()> {
    if accept_language.contains(';') {
        bail!(
            "acceptLanguage must be a plain comma-separated language list without \
             q-values; Chrome generates the quality values itself"
        );
    }
    Ok(())
}

/// Keep `uaFullVersion` consistent with `fullVersionList`.
fn with_full_version(mut data: UserAgentData) -> UserAgentData {
    if data.full_version.is_some() {
        return data;
    }
    let primary = data.full_version_list.as_ref().and_then(|list| {
        list.iter()
            .find(|entry| entry.brand == "Google Chrome" || entry.brand == "Chromium")
            .map(|entry| entry.version.clone())
    });
    if let Some(version) = primary {
        data.full_version = Some(version);
    }
    data
}

/// Normalize and validate a fingerprint profile.
///
/// Unknown keys are rejected when a profile is deserialized rather than
/// ignored: a typo in `hardwareConcurency` would otherwise silently leave the
/// real core count exposed, which is exactly the failure this module exists to
/// prevent.
pub fn resolve_fingerprint_profile(profile: &FingerprintProfile) -> Result<FingerprintProfile> {
    let mut resolved = profile.clone();

    if let Some(languages) = &resolved.languages {
        if languages.is_empty() {
            bail!("languages must not be empty");
        }
        if resolved.accept_language.is_none() {
            resolved.accept_language = Some(languages.join(","));
        }
    }
    if let Some(accept_language) = &resolved.accept_language {
        validate_accept_language(accept_language)?;
    }
    if resolved.user_agent_data.is_none() {
        if let Some(user_agent) = &resolved.user_agent {
            resolved.user_agent_data = derive_user_agent_data(user_agent);
        }
    }
    resolved.user_agent_data = resolved.user_agent_data.map(with_full_version);

    positive_integer(resolved.hardware_concurrency, "hardwareConcurrency")?;
    positive_number(resolved.device_memory, "deviceMemory")?;
    if let Some(screen) = &resolved.screen {
        validate_screen(screen)?;
    }
    if let Some(viewport) = &resolved.viewport {
        validate_viewport(viewport)?;
    }
    if let Some(geolocation) = &resolved.geolocation {
        validate_geolocation(geolocation)?;
    }
    Ok(resolved)
}

impl FingerprintProfile {
    /// Normalize and validate this profile, returning the resolved copy.
    pub fn resolve(&self) -> Result<FingerprintProfile> {
        resolve_fingerprint_profile(self)
    }

    /// The camelCase names of the fields this profile actually sets.
    ///
    /// Every name here has an entry in [`FINGERPRINT_FIELD_MECHANISMS`], which
    /// is what lets a caller report how strong each override is.
    pub fn populated_fields(&self) -> Vec<&'static str> {
        let present: [(&'static str, bool); 19] = [
            ("userAgent", self.user_agent.is_some()),
            ("userAgentData", self.user_agent_data.is_some()),
            ("acceptLanguage", self.accept_language.is_some()),
            ("languages", self.languages.is_some()),
            ("locale", self.locale.is_some()),
            ("timezoneId", self.timezone_id.is_some()),
            ("platform", self.platform.is_some()),
            ("vendor", self.vendor.is_some()),
            ("hardwareConcurrency", self.hardware_concurrency.is_some()),
            ("deviceMemory", self.device_memory.is_some()),
            ("maxTouchPoints", self.max_touch_points.is_some()),
            ("doNotTrack", self.do_not_track.is_some()),
            ("screen", self.screen.is_some()),
            ("viewport", self.viewport.is_some()),
            ("webgl", self.webgl.is_some()),
            ("geolocation", self.geolocation.is_some()),
            ("colorScheme", self.color_scheme.is_some()),
            ("reducedMotion", self.reduced_motion.is_some()),
            ("forcedColors", self.forced_colors.is_some()),
        ];
        present
            .into_iter()
            .filter_map(|(name, set)| set.then_some(name))
            .collect()
    }

    /// Set the User-Agent string.
    pub fn user_agent(mut self, user_agent: impl Into<String>) -> Self {
        self.user_agent = Some(user_agent.into());
        self
    }

    /// Set the client hints explicitly instead of deriving them.
    pub fn user_agent_data(mut self, user_agent_data: UserAgentData) -> Self {
        self.user_agent_data = Some(user_agent_data);
        self
    }

    /// Set the `Accept-Language` list.
    pub fn accept_language(mut self, accept_language: impl Into<String>) -> Self {
        self.accept_language = Some(accept_language.into());
        self
    }

    /// Set `navigator.languages`.
    pub fn languages<I, S>(mut self, languages: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.languages = Some(languages.into_iter().map(Into::into).collect());
        self
    }

    /// Set the formatting locale.
    pub fn locale(mut self, locale: impl Into<String>) -> Self {
        self.locale = Some(locale.into());
        self
    }

    /// Set the IANA time zone identifier.
    pub fn timezone_id(mut self, timezone_id: impl Into<String>) -> Self {
        self.timezone_id = Some(timezone_id.into());
        self
    }

    /// Set `navigator.platform`.
    pub fn platform(mut self, platform: impl Into<String>) -> Self {
        self.platform = Some(platform.into());
        self
    }

    /// Set `navigator.vendor`.
    pub fn vendor(mut self, vendor: impl Into<String>) -> Self {
        self.vendor = Some(vendor.into());
        self
    }

    /// Set the reported core count.
    pub fn hardware_concurrency(mut self, cores: u32) -> Self {
        self.hardware_concurrency = Some(cores);
        self
    }

    /// Set the reported device memory in gigabytes.
    pub fn device_memory(mut self, gigabytes: f64) -> Self {
        self.device_memory = Some(gigabytes);
        self
    }

    /// Set `navigator.maxTouchPoints`.
    pub fn max_touch_points(mut self, points: u32) -> Self {
        self.max_touch_points = Some(points);
        self
    }

    /// Set `navigator.doNotTrack`.
    pub fn do_not_track(mut self, do_not_track: impl Into<String>) -> Self {
        self.do_not_track = Some(do_not_track.into());
        self
    }

    /// Set the screen the page believes it is on.
    pub fn screen(mut self, screen: ScreenProfile) -> Self {
        self.screen = Some(screen);
        self
    }

    /// Set the viewport the renderer lays the page out in.
    pub fn viewport(mut self, viewport: ViewportProfile) -> Self {
        self.viewport = Some(viewport);
        self
    }

    /// Set the WebGL vendor and renderer strings.
    pub fn webgl(mut self, webgl: WebglProfile) -> Self {
        self.webgl = Some(webgl);
        self
    }

    /// Set the position the geolocation API reports.
    pub fn geolocation(mut self, geolocation: GeolocationProfile) -> Self {
        self.geolocation = Some(geolocation);
        self
    }

    /// Set the `prefers-color-scheme` media feature.
    pub fn color_scheme(mut self, color_scheme: ColorScheme) -> Self {
        self.color_scheme = Some(color_scheme);
        self
    }

    /// Set the `prefers-reduced-motion` media feature.
    pub fn reduced_motion(mut self, reduced_motion: ReducedMotion) -> Self {
        self.reduced_motion = Some(reduced_motion);
        self
    }

    /// Set the `forced-colors` media feature.
    pub fn forced_colors(mut self, forced_colors: ForcedColors) -> Self {
        self.forced_colors = Some(forced_colors);
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
         (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

    fn brand(name: &str, version: &str) -> BrandVersion {
        BrandVersion {
            brand: name.to_string(),
            version: version.to_string(),
        }
    }

    #[test]
    fn an_empty_profile_serializes_to_an_empty_object() {
        let profile = FingerprintProfile::default()
            .resolve()
            .expect("empty profile resolves");

        assert_eq!(
            serde_json::to_value(&profile).expect("serializes"),
            serde_json::json!({})
        );
        assert!(profile.populated_fields().is_empty());
    }

    #[test]
    fn drops_fields_that_were_not_supplied_instead_of_filling_in_defaults() {
        let profile = FingerprintProfile::default()
            .locale("de-DE")
            .resolve()
            .expect("resolves");

        assert_eq!(profile.populated_fields(), vec!["locale"]);
    }

    #[test]
    fn rejects_an_unknown_field_rather_than_silently_ignoring_it() {
        let error = serde_json::from_str::<FingerprintProfile>(r#"{"hardwareConcurency": 8}"#)
            .expect_err("unknown field is rejected");

        assert!(error.to_string().contains("hardwareConcurency"), "{error}");
    }

    #[test]
    fn derives_accept_language_from_languages() {
        let profile = FingerprintProfile::default()
            .languages(["de-DE", "de", "en"])
            .resolve()
            .expect("resolves");

        assert_eq!(profile.accept_language.as_deref(), Some("de-DE,de,en"));
        assert_eq!(
            profile.languages,
            Some(vec![
                "de-DE".to_string(),
                "de".to_string(),
                "en".to_string()
            ])
        );
    }

    #[test]
    fn keeps_an_explicit_accept_language_over_the_derived_one() {
        let profile = FingerprintProfile::default()
            .languages(["de-DE", "de"])
            .accept_language("fr-FR,fr")
            .resolve()
            .expect("resolves");

        assert_eq!(profile.accept_language.as_deref(), Some("fr-FR,fr"));
    }

    // Chrome splits acceptLanguage on commas without stripping q-values, so a
    // q-value ends up inside a language tag and doubled in the header.
    #[test]
    fn rejects_q_values_in_accept_language_which_chrome_would_misparse() {
        let error = FingerprintProfile::default()
            .accept_language("de-DE,de;q=0.9")
            .resolve()
            .expect_err("q-values are rejected");

        assert!(error.to_string().contains("without q-values"), "{error}");
    }

    #[test]
    fn derives_client_hints_from_a_chrome_user_agent() {
        let profile = FingerprintProfile::default()
            .user_agent(CHROME_UA)
            .resolve()
            .expect("resolves");

        let hints = profile.user_agent_data.expect("derived hints");
        assert_eq!(hints.platform.as_deref(), Some("Windows"));
        assert_eq!(hints.architecture.as_deref(), Some("x86"));
        assert_eq!(hints.bitness.as_deref(), Some("64"));
        assert_eq!(hints.mobile, Some(false));
        assert!(hints
            .brands
            .expect("brands")
            .iter()
            .any(|entry| entry.brand == "Google Chrome" && entry.version == "140"));
    }

    #[test]
    fn fills_ua_full_version_from_the_chrome_entry_of_full_version_list() {
        let profile = FingerprintProfile::default()
            .user_agent_data(UserAgentData {
                full_version_list: Some(vec![
                    brand("Not=A?Brand", "24.0.0.0"),
                    brand("Google Chrome", "140.0.7000.1"),
                ]),
                ..UserAgentData::default()
            })
            .resolve()
            .expect("resolves");

        assert_eq!(
            profile
                .user_agent_data
                .expect("hints")
                .full_version
                .as_deref(),
            Some("140.0.7000.1")
        );
    }

    #[test]
    fn keeps_an_explicit_full_version_instead_of_deriving_one() {
        let profile = FingerprintProfile::default()
            .user_agent_data(UserAgentData {
                full_version: Some("99.1.2.3".to_string()),
                full_version_list: Some(vec![brand("Google Chrome", "140.0.0.0")]),
                ..UserAgentData::default()
            })
            .resolve()
            .expect("resolves");

        assert_eq!(
            profile
                .user_agent_data
                .expect("hints")
                .full_version
                .as_deref(),
            Some("99.1.2.3")
        );
    }

    #[test]
    fn lets_an_explicit_user_agent_data_win_over_the_derived_one() {
        let profile = FingerprintProfile::default()
            .user_agent(CHROME_UA)
            .user_agent_data(UserAgentData {
                platform: Some("macOS".to_string()),
                ..UserAgentData::default()
            })
            .resolve()
            .expect("resolves");

        assert_eq!(
            profile.user_agent_data.expect("hints").platform.as_deref(),
            Some("macOS")
        );
    }

    #[test]
    fn accepts_every_configurable_field_at_once() {
        let profile = FingerprintProfile::default()
            .user_agent(CHROME_UA)
            .languages(["de-DE", "de"])
            .locale("de-DE")
            .timezone_id("Europe/Berlin")
            .platform("Win32")
            .vendor("Google Inc.")
            .hardware_concurrency(24)
            .device_memory(32.0)
            .max_touch_points(5)
            .do_not_track("1")
            .screen(ScreenProfile {
                width: Some(3840),
                height: Some(2160),
                avail_width: Some(3840),
                avail_height: Some(2100),
                color_depth: Some(30),
                pixel_depth: Some(30),
            })
            .viewport(ViewportProfile {
                width: Some(1600),
                height: Some(900),
                device_scale_factor: Some(2.0),
                mobile: Some(false),
            })
            .webgl(WebglProfile {
                unmasked_vendor: Some("NVIDIA".to_string()),
                unmasked_renderer: Some("RTX 4090".to_string()),
                ..WebglProfile::default()
            })
            .geolocation(GeolocationProfile {
                latitude: 52.52,
                longitude: 13.405,
                accuracy: Some(12.0),
            })
            .color_scheme(ColorScheme::Dark)
            .reduced_motion(ReducedMotion::Reduce)
            .forced_colors(ForcedColors::Active)
            .resolve()
            .expect("resolves");

        assert_eq!(profile.hardware_concurrency, Some(24));
        assert_eq!(profile.device_memory, Some(32.0));
        assert_eq!(profile.screen.expect("screen").color_depth, Some(30));
        assert_eq!(
            profile.viewport.expect("viewport").device_scale_factor,
            Some(2.0)
        );
        assert_eq!(
            profile.webgl.expect("webgl").unmasked_renderer.as_deref(),
            Some("RTX 4090")
        );
        assert_eq!(
            profile.geolocation.expect("geolocation").accuracy,
            Some(12.0)
        );
        assert_eq!(profile.forced_colors, Some(ForcedColors::Active));
    }

    // The JavaScript port rejects a non-integer or negative core count at run
    // time; here the type does it, so only zero can reach validation.
    #[test]
    fn rejects_a_hardware_concurrency_of_zero() {
        let error = FingerprintProfile::default()
            .hardware_concurrency(0)
            .resolve()
            .expect_err("zero cores are rejected");

        assert!(
            error
                .to_string()
                .contains("hardwareConcurrency must be a positive integer"),
            "{error}"
        );
    }

    #[test]
    fn allows_max_touch_points_to_be_zero() {
        let profile = FingerprintProfile::default()
            .max_touch_points(0)
            .resolve()
            .expect("resolves");

        assert_eq!(profile.max_touch_points, Some(0));
    }

    #[test]
    fn rejects_a_device_memory_that_is_not_a_positive_number() {
        for value in [0.0, -4.0, f64::NAN, f64::INFINITY] {
            let error = FingerprintProfile::default()
                .device_memory(value)
                .resolve()
                .expect_err("non-positive device memory is rejected");
            assert!(
                error
                    .to_string()
                    .contains("deviceMemory must be a positive number"),
                "{value}: {error}"
            );
        }
    }

    #[test]
    fn requires_screen_width_and_height_to_be_given_together() {
        let error = FingerprintProfile::default()
            .screen(ScreenProfile {
                width: Some(1920),
                ..ScreenProfile::default()
            })
            .resolve()
            .expect_err("a half screen is rejected");

        assert!(
            error
                .to_string()
                .contains("screen.width and screen.height must be provided together"),
            "{error}"
        );
    }

    #[test]
    fn requires_viewport_width_and_height_to_be_given_together() {
        let error = FingerprintProfile::default()
            .viewport(ViewportProfile {
                height: Some(900),
                ..ViewportProfile::default()
            })
            .resolve()
            .expect_err("a half viewport is rejected");

        assert!(
            error
                .to_string()
                .contains("viewport.width and viewport.height must be provided together"),
            "{error}"
        );
    }

    #[test]
    fn rejects_out_of_range_coordinates() {
        let latitude = FingerprintProfile::default()
            .geolocation(GeolocationProfile {
                latitude: 91.0,
                longitude: 0.0,
                accuracy: None,
            })
            .resolve()
            .expect_err("an impossible latitude is rejected");
        let longitude = FingerprintProfile::default()
            .geolocation(GeolocationProfile {
                latitude: 0.0,
                longitude: -181.0,
                accuracy: None,
            })
            .resolve()
            .expect_err("an impossible longitude is rejected");

        assert!(
            latitude
                .to_string()
                .contains("latitude must be between -90 and 90"),
            "{latitude}"
        );
        assert!(
            longitude
                .to_string()
                .contains("longitude must be between -180 and 180"),
            "{longitude}"
        );
    }

    #[test]
    fn rejects_an_unsupported_enum_value() {
        let error = serde_json::from_str::<FingerprintProfile>(r#"{"colorScheme": "sepia"}"#)
            .expect_err("an unknown color scheme is rejected");

        assert!(error.to_string().contains("sepia"), "{error}");
    }

    #[test]
    fn rejects_an_empty_languages_list() {
        let empty: [String; 0] = [];
        let error = FingerprintProfile::default()
            .languages(empty)
            .resolve()
            .expect_err("an empty language list is rejected");

        assert!(
            error.to_string().contains("languages must not be empty"),
            "{error}"
        );
    }

    #[test]
    fn round_trips_through_the_camel_case_names_the_protocol_uses() {
        let profile = FingerprintProfile::default()
            .hardware_concurrency(8)
            .timezone_id("UTC")
            .color_scheme(ColorScheme::NoPreference)
            .resolve()
            .expect("resolves");
        let json = serde_json::to_value(&profile).expect("serializes");

        assert_eq!(
            json,
            serde_json::json!({
                "timezoneId": "UTC",
                "hardwareConcurrency": 8,
                "colorScheme": "no-preference",
            })
        );
        assert_eq!(
            serde_json::from_value::<FingerprintProfile>(json).expect("deserializes"),
            profile
        );
    }

    #[test]
    fn records_a_mechanism_for_every_field_the_profile_accepts() {
        let every_field = FingerprintProfile::default()
            .user_agent(CHROME_UA)
            .accept_language("en-US,en")
            .languages(["en-US", "en"])
            .locale("en-US")
            .timezone_id("UTC")
            .platform("Win32")
            .vendor("Google Inc.")
            .hardware_concurrency(8)
            .device_memory(8.0)
            .max_touch_points(0)
            .do_not_track("1")
            .screen(ScreenProfile {
                width: Some(1920),
                height: Some(1080),
                ..ScreenProfile::default()
            })
            .viewport(ViewportProfile {
                width: Some(1280),
                height: Some(720),
                ..ViewportProfile::default()
            })
            .webgl(WebglProfile {
                unmasked_vendor: Some("Intel".to_string()),
                ..WebglProfile::default()
            })
            .geolocation(GeolocationProfile {
                latitude: 0.0,
                longitude: 0.0,
                accuracy: None,
            })
            .color_scheme(ColorScheme::Dark)
            .reduced_motion(ReducedMotion::Reduce)
            .forced_colors(ForcedColors::Active)
            .resolve()
            .expect("resolves");

        assert_eq!(every_field.populated_fields().len(), 19);
        for field in every_field.populated_fields() {
            assert!(
                fingerprint_field_mechanism(field).is_some(),
                "no mechanism recorded for {field}"
            );
        }
    }

    // The mechanism decides how strong an override is, so the ports disagreeing
    // here would be a documentation bug with teeth.
    #[test]
    fn mirrors_the_javascript_mechanism_table() {
        let script: Vec<&str> = FINGERPRINT_FIELD_MECHANISMS
            .iter()
            .filter(|(_, mechanism)| *mechanism == FieldMechanism::Script)
            .map(|(name, _)| *name)
            .collect();

        assert_eq!(
            script,
            vec!["vendor", "deviceMemory", "doNotTrack", "webgl"]
        );
        assert_eq!(FINGERPRINT_FIELD_MECHANISMS.len(), 19);
    }
}
