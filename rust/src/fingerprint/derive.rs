//! Derive User-Agent Client Hints from a User-Agent string.
//!
//! This exists because of a measured trap: `Emulation.setUserAgentOverride`
//! replaces the whole identity, so overriding `userAgent` *without*
//! `userAgentMetadata` leaves `navigator.userAgentData.brands` empty and
//! `getHighEntropyValues(['fullVersionList'])` returning `[]`. A real browser
//! never reports that combination, so a bare UA override is a louder automation
//! signal than the default UA it replaced. See
//! `docs/case-studies/issue-79/analysis-artifacts/ua-hints-detail.json`.
//!
//! Deriving is best effort. Chrome's GREASE brand -- the `Not=A?Brand` entry --
//! is generated from a per-version permutation table that this module does not
//! reproduce; the case study records that.
//!
//! This is the Rust side of `js/src/fingerprint/derive.js` and
//! `python/src/browser_commander/fingerprint/derive.py`. The unit tests are
//! translations of each other, so a divergence fails a test instead of
//! surfacing later as a fingerprint difference.

use std::sync::LazyLock;

use regex::Regex;

use super::profile::{BrandVersion, UserAgentData};

/// The GREASE brand Chrome mixes into every brand list.
pub const GREASE_BRAND: &str = "Not=A?Brand";
/// The version Chrome reports for its GREASE brand.
pub const GREASE_VERSION: &str = "24";

static CHROME_VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Chrome/(\d+)(?:\.(\d+)\.(\d+)\.(\d+))?").expect("Invalid regex pattern")
});

static ANDROID_MODEL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"; ([^;)]+) Build/").expect("Invalid regex pattern"));

static ANDROID_VERSION: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"Android (\d+(?:\.\d+)*)").expect("Invalid regex pattern"));

static MACOS_VERSION: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Mac OS X (\d+)[._](\d+)(?:[._](\d+))?").expect("Invalid regex pattern")
});

fn platform_from_user_agent(user_agent: &str) -> (&'static str, &'static str, &'static str) {
    if user_agent.contains("Windows NT") {
        return ("Windows", "x86", "64");
    }
    if user_agent.contains("Android") {
        return ("Android", "", "");
    }
    if user_agent.contains("Macintosh") || user_agent.contains("Mac OS X") {
        return ("macOS", "arm", "64");
    }
    if user_agent.contains("CrOS") {
        return ("Chrome OS", "x86", "64");
    }
    if user_agent.contains("X11") || user_agent.contains("Linux") {
        return ("Linux", "x86", "64");
    }
    ("", "", "")
}

fn platform_version_from_user_agent(user_agent: &str, platform: &str) -> String {
    match platform {
        // Chrome freezes the UA string at "Windows NT 10.0" and moves the real
        // version into the platformVersion hint: 13+ means Windows 11.
        "Windows" => if user_agent.contains("Windows NT 10.0") {
            "15.0.0"
        } else {
            "0.0.0"
        }
        .to_string(),
        "macOS" => MACOS_VERSION
            .captures(user_agent)
            .map(|found| {
                format!(
                    "{}.{}.{}",
                    &found[1],
                    &found[2],
                    found.get(3).map_or("0", |part| part.as_str())
                )
            })
            .unwrap_or_default(),
        "Android" => ANDROID_VERSION
            .captures(user_agent)
            .map(|found| found[1].to_string())
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn brand(name: &str, version: &str) -> BrandVersion {
    BrandVersion {
        brand: name.to_string(),
        version: version.to_string(),
    }
}

/// Build a complete `userAgentData` block for a Chrome User-Agent string.
///
/// Returns `None` when the string names no Chrome version and there is nothing
/// trustworthy to derive.
pub fn derive_user_agent_data(user_agent: &str) -> Option<UserAgentData> {
    let version = CHROME_VERSION.captures(user_agent)?;
    let major = version[1].to_string();
    let full = if version.get(2).is_some() {
        version[0]["Chrome/".len()..].to_string()
    } else {
        format!("{major}.0.0.0")
    };
    let (platform, architecture, bitness) = platform_from_user_agent(user_agent);
    let mobile = user_agent.contains("Mobile");
    let model = if mobile {
        ANDROID_MODEL
            .captures(user_agent)
            .map(|found| found[1].to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };

    Some(UserAgentData {
        brands: Some(vec![
            brand("Chromium", &major),
            brand("Google Chrome", &major),
            brand(GREASE_BRAND, GREASE_VERSION),
        ]),
        full_version_list: Some(vec![
            brand("Chromium", &full),
            brand("Google Chrome", &full),
            brand(GREASE_BRAND, &format!("{GREASE_VERSION}.0.0.0")),
        ]),
        full_version: Some(full),
        platform: Some(platform.to_string()),
        platform_version: Some(platform_version_from_user_agent(user_agent, platform)),
        architecture: Some(architecture.to_string()),
        bitness: Some(bitness.to_string()),
        model: Some(model),
        mobile: Some(mobile),
        wow64: Some(false),
        form_factors: Some(vec![if mobile { "Mobile" } else { "Desktop" }.to_string()]),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOWS_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
         (KHTML, like Gecko) Chrome/140.0.7000.55 Safari/537.36";

    #[test]
    fn returns_none_when_the_string_names_no_chrome_version() {
        assert!(derive_user_agent_data(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 \
             (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        )
        .is_none());
    }

    #[test]
    fn maps_a_windows_user_agent_onto_the_windows_platform_hints() {
        let data = derive_user_agent_data(WINDOWS_UA).expect("Chrome user agent");

        assert_eq!(data.platform.as_deref(), Some("Windows"));
        assert_eq!(data.architecture.as_deref(), Some("x86"));
        assert_eq!(data.bitness.as_deref(), Some("64"));
        assert_eq!(data.mobile, Some(false));
        assert_eq!(data.form_factors, Some(vec!["Desktop".to_string()]));
        // Chrome froze the user agent at "Windows NT 10.0" and reports the real
        // version only through platformVersion, where 13 and up mean Windows 11.
        assert_eq!(data.platform_version.as_deref(), Some("15.0.0"));
        assert_eq!(data.full_version.as_deref(), Some("140.0.7000.55"));
    }

    #[test]
    fn pads_a_major_only_chrome_version_into_a_four_part_full_version() {
        let data = derive_user_agent_data(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/141 Safari/537.36",
        )
        .expect("Chrome user agent");

        assert_eq!(data.full_version.as_deref(), Some("141.0.0.0"));
        let versions: Vec<&str> = data
            .brands
            .as_ref()
            .expect("brands")
            .iter()
            .map(|entry| entry.version.as_str())
            .collect();
        assert_eq!(versions, vec!["141", "141", "24"]);
    }

    #[test]
    fn parses_the_macos_version_out_of_the_user_agent() {
        let data = derive_user_agent_data(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        )
        .expect("Chrome user agent");

        assert_eq!(data.platform.as_deref(), Some("macOS"));
        assert_eq!(data.platform_version.as_deref(), Some("10.15.7"));
    }

    #[test]
    fn reports_an_android_phone_as_mobile_and_recovers_the_model() {
        let data = derive_user_agent_data(
            "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240105.004) \
             AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
        )
        .expect("Chrome user agent");

        assert_eq!(data.platform.as_deref(), Some("Android"));
        assert_eq!(data.platform_version.as_deref(), Some("14"));
        assert_eq!(data.mobile, Some(true));
        assert_eq!(data.model.as_deref(), Some("Pixel 8"));
        assert_eq!(data.form_factors, Some(vec!["Mobile".to_string()]));
    }

    #[test]
    fn recognises_linux_and_chrome_os() {
        let linux = derive_user_agent_data(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        )
        .expect("Chrome user agent");
        let chrome_os = derive_user_agent_data(
            "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
        )
        .expect("Chrome user agent");

        assert_eq!(linux.platform.as_deref(), Some("Linux"));
        assert_eq!(chrome_os.platform.as_deref(), Some("Chrome OS"));
    }

    #[test]
    fn includes_the_grease_brand_so_the_brand_list_has_a_real_browser_shape() {
        let data = derive_user_agent_data(WINDOWS_UA).expect("Chrome user agent");

        let brands = data.brands.as_ref().expect("brands");
        assert_eq!(brands.len(), 3);
        assert!(brands.iter().any(|entry| entry.brand == GREASE_BRAND));
        assert!(data
            .full_version_list
            .as_ref()
            .expect("fullVersionList")
            .iter()
            .all(|entry| entry.version.split('.').count() == 4));
    }
}
