//! Ready-made fingerprint profiles for the platforms Chrome ships on.
//!
//! A profile is only useful if it is internally consistent: the user agent
//! string, the User-Agent Client Hints, `navigator.platform`, the WebGL
//! renderer and the screen size all have to describe the same machine, because
//! every serious fingerprinting script cross-checks them. Each preset below is
//! therefore written as one machine rather than as a bag of independent fields.
//!
//! The Chrome version is a parameter instead of a constant. A profile claiming
//! Chrome 131 while the binary is Chrome 149 is trivially detectable from
//! feature sniffing, so the caller should pass the version of the browser they
//! actually launch.
//!
//! This is the Rust side of `js/src/fingerprint/presets.js` and
//! `python/src/browser_commander/fingerprint/presets.py`; the presets are the
//! same machines in all three languages, so a profile built here and a profile
//! built there produce the same page.

use std::sync::LazyLock;

use anyhow::{bail, Result};
use regex::Regex;

use super::profile::{
    resolve_fingerprint_profile, BrandVersion, FingerprintProfile, ScreenProfile, UserAgentData,
    ViewportProfile, WebglProfile,
};

/// The Chrome version a preset claims when the caller does not pass one.
pub const DEFAULT_CHROME_VERSION: &str = "140.0.0.0";

/// Names accepted by [`create_fingerprint_preset`].
pub const FINGERPRINT_PRESET_NAMES: &[&str] = &[
    "android-chrome",
    "linux-chrome",
    "macos-chrome",
    "windows-chrome",
];

static DOTTED_VERSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^\d+(\.\d+)*$").expect("Invalid regex pattern"));

fn major_version(version: &str) -> &str {
    version.split('.').next().unwrap_or(version)
}

fn brand(name: &str, version: &str) -> BrandVersion {
    BrandVersion {
        brand: name.to_string(),
        version: version.to_string(),
    }
}

fn brands_for(version: &str) -> Vec<BrandVersion> {
    let major = major_version(version);
    vec![
        brand("Google Chrome", major),
        brand("Chromium", major),
        brand("Not)A;Brand", "24"),
    ]
}

fn full_version_list_for(version: &str) -> Vec<BrandVersion> {
    vec![
        brand("Google Chrome", version),
        brand("Chromium", version),
        brand("Not)A;Brand", "24.0.0.0"),
    ]
}

fn desktop_user_agent(platform_token: &str, version: &str) -> String {
    format!(
        "Mozilla/5.0 ({platform_token}) AppleWebKit/537.36 (KHTML, like Gecko) \
         Chrome/{}.0.0.0 Safari/537.36",
        major_version(version)
    )
}

fn hints(version: &str, platform: &str, platform_version: &str) -> UserAgentData {
    UserAgentData {
        brands: Some(brands_for(version)),
        full_version_list: Some(full_version_list_for(version)),
        platform: Some(platform.to_string()),
        platform_version: Some(platform_version.to_string()),
        architecture: Some("x86".to_string()),
        bitness: Some("64".to_string()),
        full_version: None,
        model: Some(String::new()),
        mobile: Some(false),
        wow64: Some(false),
        form_factors: Some(vec!["Desktop".to_string()]),
    }
}

fn webgl(unmasked_vendor: &str, unmasked_renderer: &str) -> WebglProfile {
    WebglProfile {
        // Real Chrome always reports these two, whatever the GPU is; the
        // machine only shows through the unmasked pair.
        vendor: Some("WebKit".to_string()),
        renderer: Some("WebKit WebGL".to_string()),
        unmasked_vendor: Some(unmasked_vendor.to_string()),
        unmasked_renderer: Some(unmasked_renderer.to_string()),
    }
}

fn windows_chrome(version: &str) -> FingerprintProfile {
    FingerprintProfile::default()
        .user_agent(desktop_user_agent("Windows NT 10.0; Win64; x64", version))
        .user_agent_data(hints(version, "Windows", "15.0.0"))
        .platform("Win32")
        .vendor("Google Inc.")
        .languages(["en-US", "en"])
        .locale("en-US")
        .timezone_id("America/New_York")
        .hardware_concurrency(8)
        .device_memory(8.0)
        .max_touch_points(0)
        .screen(ScreenProfile {
            width: Some(1920),
            height: Some(1080),
            avail_width: Some(1920),
            avail_height: Some(1032),
            color_depth: Some(24),
            pixel_depth: Some(24),
        })
        .viewport(ViewportProfile {
            width: Some(1920),
            height: Some(947),
            device_scale_factor: Some(1.0),
            mobile: Some(false),
        })
        .webgl(webgl(
            "Google Inc. (NVIDIA)",
            "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)",
        ))
}

fn macos_chrome(version: &str) -> FingerprintProfile {
    let mut user_agent_data = hints(version, "macOS", "15.6.0");
    user_agent_data.architecture = Some("arm".to_string());
    FingerprintProfile::default()
        .user_agent(desktop_user_agent(
            "Macintosh; Intel Mac OS X 10_15_7",
            version,
        ))
        .user_agent_data(user_agent_data)
        .platform("MacIntel")
        .vendor("Google Inc.")
        .languages(["en-US", "en"])
        .locale("en-US")
        .timezone_id("America/Los_Angeles")
        .hardware_concurrency(10)
        .device_memory(8.0)
        .max_touch_points(0)
        .screen(ScreenProfile {
            width: Some(1728),
            height: Some(1117),
            avail_width: Some(1728),
            avail_height: Some(1085),
            color_depth: Some(30),
            pixel_depth: Some(30),
        })
        .viewport(ViewportProfile {
            width: Some(1728),
            height: Some(1005),
            device_scale_factor: Some(2.0),
            mobile: Some(false),
        })
        .webgl(webgl(
            "Google Inc. (Apple)",
            "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)",
        ))
}

fn linux_chrome(version: &str) -> FingerprintProfile {
    FingerprintProfile::default()
        .user_agent(desktop_user_agent("X11; Linux x86_64", version))
        .user_agent_data(hints(version, "Linux", ""))
        .platform("Linux x86_64")
        .vendor("Google Inc.")
        .languages(["en-US", "en"])
        .locale("en-US")
        .timezone_id("UTC")
        .hardware_concurrency(8)
        .device_memory(8.0)
        .max_touch_points(0)
        .screen(ScreenProfile {
            width: Some(1920),
            height: Some(1080),
            avail_width: Some(1920),
            avail_height: Some(1053),
            color_depth: Some(24),
            pixel_depth: Some(24),
        })
        .viewport(ViewportProfile {
            width: Some(1920),
            height: Some(955),
            device_scale_factor: Some(1.0),
            mobile: Some(false),
        })
        .webgl(webgl(
            "Google Inc. (Intel)",
            "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630 (CFL GT2), OpenGL 4.6)",
        ))
}

fn android_chrome(version: &str) -> FingerprintProfile {
    let mut user_agent_data = hints(version, "Android", "15.0.0");
    user_agent_data.architecture = Some(String::new());
    user_agent_data.bitness = Some(String::new());
    user_agent_data.model = Some("Pixel 8".to_string());
    user_agent_data.mobile = Some(true);
    user_agent_data.form_factors = Some(vec!["Mobile".to_string()]);
    FingerprintProfile::default()
        .user_agent(format!(
            "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/{}.0.0.0 Mobile Safari/537.36",
            major_version(version)
        ))
        .user_agent_data(user_agent_data)
        .platform("Linux armv81")
        .vendor("Google Inc.")
        .languages(["en-US", "en"])
        .locale("en-US")
        .timezone_id("America/New_York")
        .hardware_concurrency(8)
        .device_memory(8.0)
        .max_touch_points(5)
        .screen(ScreenProfile {
            width: Some(412),
            height: Some(915),
            avail_width: Some(412),
            avail_height: Some(915),
            color_depth: Some(24),
            pixel_depth: Some(24),
        })
        .viewport(ViewportProfile {
            width: Some(412),
            height: Some(823),
            device_scale_factor: Some(2.625),
            mobile: Some(true),
        })
        .webgl(webgl(
            "Google Inc. (Qualcomm)",
            "ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)",
        ))
}

/// Build a complete, internally consistent fingerprint profile.
///
/// `chrome_version` is the full dotted version of the browser the caller
/// actually launches, for example `140.0.7339.80`.
pub fn create_fingerprint_preset(name: &str, chrome_version: &str) -> Result<FingerprintProfile> {
    if !DOTTED_VERSION.is_match(chrome_version) {
        bail!("chromeVersion must be a dotted numeric version string");
    }
    let profile = match name {
        "windows-chrome" => windows_chrome(chrome_version),
        "macos-chrome" => macos_chrome(chrome_version),
        "linux-chrome" => linux_chrome(chrome_version),
        "android-chrome" => android_chrome(chrome_version),
        _ => bail!(
            "unknown fingerprint preset \"{name}\"; known presets: {}",
            FINGERPRINT_PRESET_NAMES.join(", ")
        ),
    };
    resolve_fingerprint_profile(&profile)
}

/// Build a preset for [`DEFAULT_CHROME_VERSION`].
pub fn create_default_fingerprint_preset(name: &str) -> Result<FingerprintProfile> {
    create_fingerprint_preset(name, DEFAULT_CHROME_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_platforms_chrome_ships_on() {
        assert_eq!(
            FINGERPRINT_PRESET_NAMES,
            &[
                "android-chrome",
                "linux-chrome",
                "macos-chrome",
                "windows-chrome"
            ]
        );
    }

    #[test]
    fn rejects_an_unknown_preset_and_lists_the_known_ones() {
        let error =
            create_default_fingerprint_preset("windows-edge").expect_err("unknown preset fails");

        assert!(
            error
                .to_string()
                .contains("unknown fingerprint preset \"windows-edge\""),
            "{error}"
        );
        assert!(error.to_string().contains("windows-chrome"), "{error}");
    }

    #[test]
    fn rejects_a_chrome_version_that_is_not_a_dotted_number() {
        for chrome_version in ["latest", "", "140.x"] {
            let error = create_fingerprint_preset("linux-chrome", chrome_version)
                .expect_err("a non-numeric version fails");
            assert!(
                error.to_string().contains("dotted numeric version string"),
                "{chrome_version}: {error}"
            );
        }
    }

    // Every serious fingerprinting script cross-checks these against each other,
    // so a preset is only useful when they agree.
    #[test]
    fn describes_one_machine_consistently() {
        let expectations = [
            (
                "windows-chrome",
                "Win32",
                "Windows NT 10.0",
                "Windows",
                false,
            ),
            ("macos-chrome", "MacIntel", "Mac OS X", "macOS", false),
            (
                "linux-chrome",
                "Linux x86_64",
                "X11; Linux x86_64",
                "Linux",
                false,
            ),
            (
                "android-chrome",
                "Linux armv81",
                "Android 15",
                "Android",
                true,
            ),
        ];

        for (name, platform, ua_token, hint, mobile) in expectations {
            let profile = create_default_fingerprint_preset(name).expect("preset builds");
            let user_agent = profile.user_agent.clone().expect("user agent");
            let hints = profile.user_agent_data.clone().expect("hints");

            assert_eq!(profile.platform.as_deref(), Some(platform), "{name}");
            assert!(user_agent.contains(ua_token), "{name}");
            assert_eq!(hints.platform.as_deref(), Some(hint), "{name}");
            assert_eq!(hints.mobile, Some(mobile), "{name}");
            assert_eq!(
                profile.viewport.expect("viewport").mobile,
                Some(mobile),
                "{name}"
            );
            assert_eq!(user_agent.contains("Mobile Safari"), mobile, "{name}");
            assert_eq!(
                hints.form_factors,
                Some(vec![if mobile { "Mobile" } else { "Desktop" }.to_string()]),
                "{name}"
            );
        }
    }

    #[test]
    fn keeps_the_viewport_inside_the_screen_it_claims() {
        for name in FINGERPRINT_PRESET_NAMES {
            let profile = create_default_fingerprint_preset(name).expect("preset builds");
            let screen = profile.screen.expect("screen");
            let viewport = profile.viewport.expect("viewport");

            assert!(viewport.width <= screen.width, "{name}");
            assert!(viewport.height <= screen.avail_height, "{name}");
            assert!(screen.avail_width <= screen.width, "{name}");
            assert!(screen.avail_height <= screen.height, "{name}");
        }
    }

    #[test]
    fn gives_touch_points_only_to_the_mobile_preset() {
        assert_eq!(
            create_default_fingerprint_preset("android-chrome")
                .expect("preset builds")
                .max_touch_points,
            Some(5)
        );
        for name in ["windows-chrome", "macos-chrome", "linux-chrome"] {
            assert_eq!(
                create_default_fingerprint_preset(name)
                    .expect("preset builds")
                    .max_touch_points,
                Some(0),
                "{name}"
            );
        }
    }

    #[test]
    fn puts_the_requested_chrome_version_everywhere_it_appears() {
        let profile =
            create_fingerprint_preset("windows-chrome", "141.0.7390.55").expect("preset builds");
        let hints = profile.user_agent_data.expect("hints");

        // The user agent carries only the major version, as Chrome freezes it.
        assert!(profile
            .user_agent
            .expect("user agent")
            .contains("Chrome/141.0.0.0"));
        for entry in hints.brands.expect("brands") {
            assert!(
                entry.version == "141" || entry.version == "24",
                "{}",
                entry.brand
            );
        }
        assert!(hints
            .full_version_list
            .expect("fullVersionList")
            .iter()
            .any(|entry| entry.version == "141.0.7390.55"));
    }

    #[test]
    fn every_preset_resolves_with_the_fields_an_override_needs() {
        for name in FINGERPRINT_PRESET_NAMES {
            let profile = create_default_fingerprint_preset(name).expect("preset builds");

            assert_eq!(
                profile.accept_language.as_deref(),
                Some("en-US,en"),
                "{name}"
            );
            // The derived uaFullVersion is what a page reads through
            // getHighEntropyValues, so it has to survive normalization.
            assert_eq!(
                profile
                    .user_agent_data
                    .as_ref()
                    .expect("hints")
                    .full_version
                    .as_deref(),
                Some(DEFAULT_CHROME_VERSION),
                "{name}"
            );
            assert_eq!(
                profile.populated_fields(),
                vec![
                    "userAgent",
                    "userAgentData",
                    "acceptLanguage",
                    "languages",
                    "locale",
                    "timezoneId",
                    "platform",
                    "vendor",
                    "hardwareConcurrency",
                    "deviceMemory",
                    "maxTouchPoints",
                    "screen",
                    "viewport",
                    "webgl",
                ],
                "{name}"
            );
        }
    }
}
