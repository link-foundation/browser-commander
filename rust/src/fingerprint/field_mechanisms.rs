//! How each configurable profile field reaches the page.
//!
//! Kept beside `profile` rather than inside it because it answers a different
//! question: `profile` decides what a page is allowed to see, this decides how
//! strongly each of those values is enforced, and a caller reading the second
//! is usually deciding whether an override is detectable.

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fingerprint::profile::{
        ColorScheme, FingerprintProfile, ForcedColors, GeolocationProfile, ReducedMotion,
        ScreenProfile, ViewportProfile, WebglProfile,
    };

    const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
         (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

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
