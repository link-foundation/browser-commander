//! What Browser Commander cannot make identical, and why.
//!
//! Issue 79 asks for the limitations to be stated clearly rather than implied,
//! so every entry names the surface, the mechanism that would be needed, the
//! privacy consequence, and the evidence it rests on. Entries marked
//! [`LimitationEvidence::Measured`] were reproduced in this repository; the
//! artifacts are under `docs/case-studies/issue-79/analysis-artifacts/`.
//!
//! The catalogue itself is data, not code. `limitations.json` next to this
//! module is a byte-for-byte copy of `js/src/fingerprint/limitations.json`,
//! embedded with `include_str!` and kept in step by
//! `scripts/check-shared-fingerprint-assets.sh`. Three hand-written
//! translations of the same eleven paragraphs would drift within a release.

use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use super::profile::FingerprintProfile;

/// The shared catalogue source, embedded at compile time.
pub const FINGERPRINT_LIMITATIONS_SOURCE: &str = include_str!("limitations.json");

/// How much a limitation helps someone identify the browser.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LimitationSeverity {
    /// On its own it identifies automation or the physical machine.
    High,
    /// A strong signal when combined with others.
    Medium,
    /// It narrows the field but is common in real browsers too.
    Low,
}

/// Where the claim in an entry comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LimitationEvidence {
    /// Reproduced in this repository; `reference` names the artifact.
    Measured,
    /// Taken from browser source or a specification.
    Documented,
}

/// One documented difference a page can still observe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FingerprintLimitation {
    /// Stable identifier.
    pub id: String,
    /// What the page can observe.
    pub surface: String,
    /// How much it gives away.
    pub severity: LimitationSeverity,
    /// Whether the entry was measured here or read from a source.
    pub evidence: LimitationEvidence,
    /// What happens and why it cannot be fixed here.
    pub detail: String,
    /// What a caller can do about it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workaround: Option<String>,
    /// Artifact, source file or specification.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

/// Every documented limitation, in the order the catalogue declares them.
pub static FINGERPRINT_LIMITATIONS: LazyLock<Vec<FingerprintLimitation>> = LazyLock::new(|| {
    serde_json::from_str(FINGERPRINT_LIMITATIONS_SOURCE)
        .expect("limitations.json is embedded at compile time and has to parse")
});

/// Limitations that apply no matter what the profile asks for.
const ALWAYS_RELEVANT: &[&str] = &[
    "canvas-audio-font-follow-the-host",
    "network-layer-not-covered",
];

/// What a caller knows about the browser that the profile does not say.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LimitationContext {
    /// Whether the browser runs headless.
    pub headless: bool,
    /// Whether the browser was launched by somebody else, so the automation
    /// switches are already fixed.
    pub attached: bool,
}

/// Look a limitation up by id, or `None` when there is no such id.
pub fn find_fingerprint_limitation(id: &str) -> Option<&'static FingerprintLimitation> {
    FINGERPRINT_LIMITATIONS
        .iter()
        .find(|limitation| limitation.id == id)
}

/// Whether the screen asks for a field the `Emulation` domain does not carry.
fn screen_needs_patching(profile: &FingerprintProfile) -> bool {
    profile.screen.as_ref().is_some_and(|screen| {
        screen.color_depth.is_some()
            || screen.pixel_depth.is_some()
            || screen.avail_width.is_some()
            || screen.avail_height.is_some()
    })
}

/// Fields a worker reads differently from its document: the ones no override
/// reaches, plus the ones the page session keeps to itself.
fn touches_a_worker_visible_field(profile: &FingerprintProfile) -> bool {
    profile.device_memory.is_some()
        || profile.vendor.is_some()
        || profile.do_not_track.is_some()
        || profile.webgl.is_some()
        || profile.platform.is_some()
        || profile.languages.is_some()
        || profile.hardware_concurrency.is_some()
}

/// The limitations that apply to a specific profile.
///
/// A profile that never touches WebGL does not need to hear about the WebGL
/// limitation, and hiding the irrelevant entries is what makes the relevant
/// ones worth reading.
pub fn relevant_fingerprint_limitations(
    profile: &FingerprintProfile,
    context: LimitationContext,
) -> Vec<&'static FingerprintLimitation> {
    FINGERPRINT_LIMITATIONS
        .iter()
        .filter(|limitation| {
            if ALWAYS_RELEVANT.contains(&limitation.id.as_str()) {
                return true;
            }
            match limitation.id.as_str() {
                "automation-controlled-is-launch-only" => context.attached,
                "no-cdp-device-memory-override" => profile.device_memory.is_some(),
                "no-cdp-vendor-or-dnt-override" => {
                    profile.vendor.is_some() || profile.do_not_track.is_some()
                }
                "screen-depth-and-avail-not-emulated" => screen_needs_patching(profile),
                "webgl-strings-only" => profile.webgl.is_some(),
                "grease-brand-not-reproduced" => profile.user_agent_data.is_some(),
                "touch-emulation-changes-pointer-media" => {
                    profile.max_touch_points.is_some_and(|points| points > 0)
                }
                "headless-is-distinguishable" => context.headless,
                "init-script-does-not-reach-workers" => touches_a_worker_visible_field(profile),
                _ => false,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fingerprint::profile::{ScreenProfile, UserAgentData, WebglProfile};

    fn ids(limitations: &[&FingerprintLimitation]) -> Vec<String> {
        limitations
            .iter()
            .map(|limitation| limitation.id.clone())
            .collect()
    }

    #[test]
    fn gives_every_entry_a_unique_id_and_the_fields_a_reader_needs() {
        let mut seen = Vec::new();
        for limitation in FINGERPRINT_LIMITATIONS.iter() {
            assert!(
                !seen.contains(&limitation.id),
                "duplicate {}",
                limitation.id
            );
            seen.push(limitation.id.clone());
            assert!(!limitation.surface.is_empty(), "{}", limitation.id);
            assert!(!limitation.detail.is_empty(), "{}", limitation.id);
        }
        assert_eq!(seen.len(), 11);
    }

    #[test]
    fn points_every_measured_entry_at_the_artifact_that_proves_it() {
        for limitation in FINGERPRINT_LIMITATIONS.iter() {
            if limitation.evidence == LimitationEvidence::Measured {
                assert!(
                    limitation.reference.is_some(),
                    "{} needs a reference",
                    limitation.id
                );
            }
        }
    }

    #[test]
    fn ships_the_catalogue_that_the_javascript_package_owns() {
        // The check script compares the bytes; this asserts the copy next to
        // this module is the one the crate actually embeds.
        let canonical = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../js/src/fingerprint/limitations.json"),
        )
        .expect("the JavaScript package owns the catalogue");

        assert_eq!(canonical, FINGERPRINT_LIMITATIONS_SOURCE);
    }

    #[test]
    fn looks_an_entry_up_by_id() {
        assert_eq!(
            find_fingerprint_limitation("webgl-strings-only")
                .expect("the entry is in the catalogue")
                .surface,
            "WebGL renderer strings and driver limits"
        );
        assert!(find_fingerprint_limitation("no-such-limitation").is_none());
    }

    #[test]
    fn always_reports_the_two_nothing_can_be_done_about() {
        let relevant = relevant_fingerprint_limitations(
            &FingerprintProfile::default(),
            LimitationContext::default(),
        );

        assert_eq!(
            ids(&relevant),
            vec![
                "canvas-audio-font-follow-the-host",
                "network-layer-not-covered"
            ]
        );
    }

    #[test]
    fn mentions_the_launch_only_switch_only_when_attached() {
        let profile = FingerprintProfile::default();
        let detached = relevant_fingerprint_limitations(&profile, LimitationContext::default());
        assert!(!ids(&detached).contains(&"automation-controlled-is-launch-only".to_string()));

        let attached = relevant_fingerprint_limitations(
            &profile,
            LimitationContext {
                attached: true,
                ..Default::default()
            },
        );
        assert!(ids(&attached).contains(&"automation-controlled-is-launch-only".to_string()));
    }

    #[test]
    fn mentions_headless_only_for_a_headless_browser() {
        let relevant = relevant_fingerprint_limitations(
            &FingerprintProfile::default(),
            LimitationContext {
                headless: true,
                ..Default::default()
            },
        );

        assert!(ids(&relevant).contains(&"headless-is-distinguishable".to_string()));
    }

    #[test]
    fn mentions_the_javascript_only_fields_when_the_profile_sets_them() {
        let memory = FingerprintProfile {
            device_memory: Some(8.0),
            ..Default::default()
        };
        assert!(ids(&relevant_fingerprint_limitations(
            &memory,
            LimitationContext::default()
        ))
        .contains(&"no-cdp-device-memory-override".to_string()));

        let dnt = FingerprintProfile {
            do_not_track: Some("1".to_string()),
            ..Default::default()
        };
        assert!(ids(&relevant_fingerprint_limitations(
            &dnt,
            LimitationContext::default()
        ))
        .contains(&"no-cdp-vendor-or-dnt-override".to_string()));

        let webgl = FingerprintProfile {
            webgl: Some(WebglProfile {
                vendor: Some("WebKit".to_string()),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(ids(&relevant_fingerprint_limitations(
            &webgl,
            LimitationContext::default()
        ))
        .contains(&"webgl-strings-only".to_string()));
    }

    #[test]
    fn mentions_the_screen_entry_only_for_the_fields_cdp_does_not_emulate() {
        let emulated = FingerprintProfile {
            screen: Some(ScreenProfile {
                width: Some(1920),
                height: Some(1080),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(!ids(&relevant_fingerprint_limitations(
            &emulated,
            LimitationContext::default()
        ))
        .contains(&"screen-depth-and-avail-not-emulated".to_string()));

        let patched = FingerprintProfile {
            screen: Some(ScreenProfile {
                width: Some(1920),
                height: Some(1080),
                avail_height: Some(1032),
                ..Default::default()
            }),
            ..Default::default()
        };
        assert!(ids(&relevant_fingerprint_limitations(
            &patched,
            LimitationContext::default()
        ))
        .contains(&"screen-depth-and-avail-not-emulated".to_string()));
    }

    #[test]
    fn mentions_the_pointer_side_effect_only_when_touch_is_enabled() {
        let mouse = FingerprintProfile {
            max_touch_points: Some(0),
            ..Default::default()
        };
        assert!(!ids(&relevant_fingerprint_limitations(
            &mouse,
            LimitationContext::default()
        ))
        .contains(&"touch-emulation-changes-pointer-media".to_string()));

        let touch = FingerprintProfile {
            max_touch_points: Some(5),
            ..Default::default()
        };
        assert!(ids(&relevant_fingerprint_limitations(
            &touch,
            LimitationContext::default()
        ))
        .contains(&"touch-emulation-changes-pointer-media".to_string()));
    }

    #[test]
    fn mentions_the_grease_brand_when_the_profile_pins_client_hints() {
        let hints = FingerprintProfile {
            user_agent_data: Some(UserAgentData::default()),
            ..Default::default()
        };

        assert!(ids(&relevant_fingerprint_limitations(
            &hints,
            LimitationContext::default()
        ))
        .contains(&"grease-brand-not-reproduced".to_string()));
    }

    #[test]
    fn mentions_workers_for_every_field_a_worker_reads_differently() {
        // Measured in worker-visibility.json: platform, languages and
        // hardwareConcurrency revert to the host values inside a worker even
        // though the page session overrides them.
        let profiles = [
            FingerprintProfile {
                platform: Some("Win32".to_string()),
                ..Default::default()
            },
            FingerprintProfile {
                languages: Some(vec!["de-DE".to_string()]),
                ..Default::default()
            },
            FingerprintProfile {
                hardware_concurrency: Some(8),
                ..Default::default()
            },
            FingerprintProfile {
                device_memory: Some(8.0),
                ..Default::default()
            },
        ];
        for profile in &profiles {
            assert!(
                ids(&relevant_fingerprint_limitations(
                    profile,
                    LimitationContext::default()
                ))
                .contains(&"init-script-does-not-reach-workers".to_string()),
                "{profile:?}"
            );
        }

        let timezone = FingerprintProfile {
            timezone_id: Some("UTC".to_string()),
            ..Default::default()
        };
        assert!(!ids(&relevant_fingerprint_limitations(
            &timezone,
            LimitationContext::default()
        ))
        .contains(&"init-script-does-not-reach-workers".to_string()));
    }

    #[test]
    fn keeps_the_declaration_order_of_the_catalogue() {
        let relevant = relevant_fingerprint_limitations(
            &FingerprintProfile {
                device_memory: Some(8.0),
                webgl: Some(WebglProfile {
                    vendor: Some("WebKit".to_string()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            LimitationContext {
                headless: true,
                attached: true,
            },
        );

        let declared: Vec<String> = FINGERPRINT_LIMITATIONS
            .iter()
            .filter(|limitation| ids(&relevant).contains(&limitation.id))
            .map(|limitation| limitation.id.clone())
            .collect();
        assert_eq!(ids(&relevant), declared);
    }
}
