//! Page init script for the fingerprint surfaces CDP cannot override.
//!
//! Everything here is strictly worse than a browser-enforced override: a
//! JavaScript patch is visible to anyone who inspects the property descriptor
//! carefully enough, and it does not reach workers or HTTP headers. It exists
//! only for fields the `Emulation` domain has no command for, and for
//! connecting to a browser somebody else launched, where the switches can no
//! longer be changed.
//!
//! The payload itself is not written here. `init_payload.js` next to this
//! module is a byte-for-byte copy of `js/src/fingerprint/init-payload.js`, kept
//! in step by `scripts/check-shared-init-payload.sh`, so all three
//! implementations send Chrome the same script rather than three hand-written
//! translations of it.

use serde_json::{json, Map, Value};

use super::profile::FingerprintProfile;

/// The shared payload source, embedded at compile time.
pub const FINGERPRINT_PAYLOAD_SOURCE: &str = include_str!("init_payload.js");

/// What the init script still has to patch after the CDP overrides.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InitScriptOptions {
    /// Force `navigator.webdriver` to `false` from JavaScript.
    ///
    /// Only needed when the browser was launched by somebody else and
    /// `--disable-blink-features=AutomationControlled` can no longer be passed.
    pub patch_webdriver: bool,
    /// Also patch `navigator.languages`, which the browser already sets from
    /// `acceptLanguage`.
    pub patch_languages: bool,
}

/// Decide what the init script still has to do after the CDP overrides.
///
/// Returns `None` when the browser-side overrides already cover everything.
pub fn build_init_script_config(
    profile: &FingerprintProfile,
    options: InitScriptOptions,
) -> Option<Value> {
    let mut config = Map::new();

    if options.patch_webdriver {
        config.insert("webdriver".to_string(), json!(false));
    }
    if let Some(device_memory) = profile.device_memory {
        config.insert("deviceMemory".to_string(), json!(device_memory));
    }
    if let Some(vendor) = &profile.vendor {
        config.insert("vendor".to_string(), json!(vendor));
    }
    if let Some(do_not_track) = &profile.do_not_track {
        config.insert("doNotTrack".to_string(), json!(do_not_track));
    }
    if options.patch_languages {
        if let Some(languages) = &profile.languages {
            config.insert("languages".to_string(), json!(languages));
        }
    }
    if let Some(webgl) = &profile.webgl {
        config.insert("webgl".to_string(), json!(webgl));
    }
    if let Some(screen) = &profile.screen {
        // width and height are already enforced by setDeviceMetricsOverride;
        // the avail*/depth fields are not, so only those need patching.
        let mut patched = Map::new();
        for (name, value) in [
            ("availWidth", screen.avail_width),
            ("availHeight", screen.avail_height),
            ("colorDepth", screen.color_depth),
            ("pixelDepth", screen.pixel_depth),
        ] {
            if let Some(value) = value {
                patched.insert(name.to_string(), json!(value));
            }
        }
        if !patched.is_empty() {
            config.insert("screen".to_string(), Value::Object(patched));
        }
    }

    if config.is_empty() {
        None
    } else {
        Some(Value::Object(config))
    }
}

/// Serialize the init script for a profile, or `None` when none is needed.
pub fn build_fingerprint_init_script(
    profile: &FingerprintProfile,
    options: InitScriptOptions,
) -> Option<String> {
    let config = build_init_script_config(profile, options)?;
    // The payload is wrapped in an IIFE so the declaration never becomes a
    // property of the page's global object; a stray `fingerprintPayload` global
    // would be a far louder signal than anything the payload hides.
    Some(format!(
        "(() => {{\n{FINGERPRINT_PAYLOAD_SOURCE}\nfingerprintPayload({config});\n}})();"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fingerprint::profile::{ScreenProfile, WebglProfile};

    fn config(profile: FingerprintProfile, options: InitScriptOptions) -> Option<Value> {
        build_init_script_config(&profile.resolve().expect("profile resolves"), options)
    }

    fn script(profile: FingerprintProfile, options: InitScriptOptions) -> Option<String> {
        build_fingerprint_init_script(&profile.resolve().expect("profile resolves"), options)
    }

    #[test]
    fn returns_nothing_when_the_browser_side_overrides_cover_everything() {
        let profile = FingerprintProfile::default()
            .user_agent("Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0.0.0")
            .timezone_id("UTC")
            .hardware_concurrency(8)
            .max_touch_points(0);

        assert_eq!(config(profile.clone(), InitScriptOptions::default()), None);
        assert_eq!(script(profile, InitScriptOptions::default()), None);
    }

    #[test]
    fn patches_only_the_fields_the_emulation_domain_has_no_command_for() {
        // hardwareConcurrency and timezoneId are browser-enforced, so they must
        // not appear in the weaker JavaScript patch.
        let config = config(
            FingerprintProfile::default()
                .device_memory(8.0)
                .vendor("Google Inc.")
                .do_not_track("1")
                .hardware_concurrency(8)
                .timezone_id("UTC"),
            InitScriptOptions::default(),
        )
        .expect("something is left to patch");
        let mut keys: Vec<_> = config
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();

        assert_eq!(keys, vec!["deviceMemory", "doNotTrack", "vendor"]);
    }

    #[test]
    fn adds_webdriver_only_when_the_caller_asks_for_it() {
        let profile = FingerprintProfile::default().vendor("Google Inc.");

        assert_eq!(
            config(profile.clone(), InitScriptOptions::default()).expect("config")["webdriver"],
            Value::Null
        );
        assert_eq!(
            config(
                profile,
                InitScriptOptions {
                    patch_webdriver: true,
                    ..InitScriptOptions::default()
                }
            )
            .expect("config")["webdriver"],
            json!(false)
        );
    }

    #[test]
    fn patches_webdriver_even_for_an_otherwise_empty_profile() {
        let script = script(
            FingerprintProfile::default(),
            InitScriptOptions {
                patch_webdriver: true,
                ..InitScriptOptions::default()
            },
        )
        .expect("a script is produced");

        assert!(script.contains("\"webdriver\":false"));
    }

    #[test]
    fn leaves_languages_to_the_browser_unless_explicitly_asked() {
        let profile = FingerprintProfile::default().languages(["fr-FR", "fr"]);

        assert_eq!(config(profile.clone(), InitScriptOptions::default()), None);
        assert_eq!(
            config(
                profile,
                InitScriptOptions {
                    patch_languages: true,
                    ..InitScriptOptions::default()
                }
            )
            .expect("config")["languages"],
            json!(["fr-FR", "fr"])
        );
    }

    #[test]
    fn drops_the_screen_dimensions_set_device_metrics_override_already_enforces() {
        let config = config(
            FingerprintProfile::default().screen(ScreenProfile {
                width: Some(1920),
                height: Some(1080),
                avail_width: Some(1920),
                avail_height: Some(1032),
                color_depth: Some(24),
                pixel_depth: Some(24),
            }),
            InitScriptOptions::default(),
        )
        .expect("config");

        assert_eq!(
            config["screen"],
            json!({
                "availWidth": 1920,
                "availHeight": 1032,
                "colorDepth": 24,
                "pixelDepth": 24,
            })
        );
    }

    #[test]
    fn skips_the_screen_patch_when_only_width_and_height_are_given() {
        assert_eq!(
            config(
                FingerprintProfile::default().screen(ScreenProfile {
                    width: Some(1920),
                    height: Some(1080),
                    ..ScreenProfile::default()
                }),
                InitScriptOptions::default()
            ),
            None
        );
    }

    #[test]
    fn wraps_the_shared_payload_and_calls_it_with_the_config() {
        let script = script(
            FingerprintProfile::default().webgl(WebglProfile {
                unmasked_vendor: Some("Google Inc. (NVIDIA)".to_string()),
                ..WebglProfile::default()
            }),
            InitScriptOptions::default(),
        )
        .expect("a script is produced");

        assert!(script.starts_with("(() => {\n"));
        assert!(script.ends_with("\n})();"));
        assert!(script.contains(FINGERPRINT_PAYLOAD_SOURCE));
        assert!(script.contains("fingerprintPayload({"));
        assert!(script.contains("Google Inc. (NVIDIA)"));
    }

    // The payload is one asset shared with the JavaScript and Python packages;
    // it is source text for a classic script, so module syntax would be a
    // syntax error in the page rather than a failure here.
    #[test]
    fn embeds_the_shared_payload_asset_verbatim() {
        assert!(FINGERPRINT_PAYLOAD_SOURCE.contains("function fingerprintPayload(config) {"));
        for line in FINGERPRINT_PAYLOAD_SOURCE.lines() {
            assert!(
                !line.starts_with("import ") && !line.starts_with("export "),
                "the payload must stay a classic script: {line}"
            );
        }
    }
}
