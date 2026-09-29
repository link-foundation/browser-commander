//! Cookie migration, mirroring `js/src/browser/migration/cookies.js`.
//!
//! Cookies are read from the source profile with the existing
//! [`read_browser_cookies`] (which handles the per-platform keystore and the
//! v10/v11 decryption), optionally filtered by domain, and returned so the
//! launcher can seed them into the dedicated profile over CDP with the existing
//! `seed_cookies` path. This module does not write anything into the target
//! profile itself; the CDP seed is what a real, running browser accepts.
//!
//! ## Device Bound Session Credentials (DBSC)
//!
//! Google has shipped Device Bound Session Credentials: the session is bound to
//! a private key held in the device's TPM or Secure Enclave, and the short
//! "session token" cookies are rotated by the browser using that key. The key
//! cannot leave the profile, so a copied Google session cannot be refreshed
//! from another profile and expires quickly.
//!
//! References:
//! - <https://developer.chrome.com/docs/web-platform/device-bound-session-credentials>
//! - <https://github.com/WICG/dbsc> (the DBSC explainer)
//!
//! Detection is twofold:
//!
//! 1. By name+domain: the rotating bound cookies Chrome refreshes for a Google
//!    sign-in are `__Secure-1PSIDTS`, `__Secure-3PSIDTS` and `SIDTS` on
//!    `google.*` hosts. These are copied (so the rest of the session's cookies
//!    stay coherent) but reported in `skipped` with the reason `dbsc-bound`.
//! 2. By registration: if the source profile stores a DBSC registration
//!    database (`DeviceBoundSessions`, under the profile's `Network`
//!    directory), a warning is added. The registration itself is not copied
//!    because it is bound to the source device's key.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};

use anyhow::Result;
use regex::Regex;

use super::fs_utils::path_exists;
use super::{ClassOutcome, MigrationEntry};
use crate::browser::browser_cookies::{
    read_browser_cookies, BrowserCookie, BrowserCookieReadOptions,
};

/// Rotating Google session-token cookies that DBSC binds to the device key.
pub const DBSC_BOUND_COOKIE_NAMES: [&str; 3] = ["__Secure-1PSIDTS", "__Secure-3PSIDTS", "SIDTS"];

/// DBSC registration databases Chrome may write in the profile.
const DBSC_REGISTRATION_FILES: [&str; 2] = ["Network/DeviceBoundSessions", "DeviceBoundSessions"];

const DBSC_REGISTRATION_DETAIL: &str = "The source profile has a Device Bound Session registration; cookies covered by it are bound to the source device key and will expire in the migrated profile.";

/// Reads installed-browser cookies; the default is [`read_browser_cookies`].
pub type CookieReader =
    Arc<dyn Fn(BrowserCookieReadOptions) -> Result<Vec<BrowserCookie>> + Send + Sync>;

/// The default cookie reader.
pub(crate) fn default_cookie_reader() -> CookieReader {
    Arc::new(read_browser_cookies)
}

static GOOGLE_COUNTRY_HOST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(^|\.)google\.[a-z.]+$").expect("the Google host pattern is valid")
});

fn is_google_host(domain: &str) -> bool {
    let host = domain.strip_prefix('.').unwrap_or(domain).to_lowercase();
    host == "google.com" || host.ends_with(".google.com") || GOOGLE_COUNTRY_HOST.is_match(&host)
}

/// Decide whether a cookie is a DBSC-bound Google session cookie.
pub(crate) fn is_dbsc_bound_cookie(cookie: &BrowserCookie) -> bool {
    is_google_host(&cookie.domain) && DBSC_BOUND_COOKIE_NAMES.contains(&cookie.name.as_str())
}

fn find_dbsc_registration(profile_dir: &Path) -> Option<PathBuf> {
    DBSC_REGISTRATION_FILES
        .iter()
        .map(|relative| profile_dir.join(relative))
        .find(|candidate| path_exists(candidate))
}

/// Where the source cookies come from.
pub(crate) struct CookieSource<'a> {
    pub browser: &'a str,
    pub profile: Option<&'a str>,
    pub source_profile_dir: Option<&'a Path>,
    pub domains: &'a [String],
    pub platform: &'a str,
    pub home_dir: &'a Path,
}

/// Read cookies from the source browser, tag the DBSC-bound ones, and return
/// the cookies to seed plus the migration report fragment.
pub(crate) fn migrate_cookies(
    source: &CookieSource<'_>,
    read_cookies: &CookieReader,
) -> Result<(Vec<BrowserCookie>, ClassOutcome)> {
    let domain_filters: Vec<Option<&str>> = if source.domains.is_empty() {
        vec![None]
    } else {
        source
            .domains
            .iter()
            .map(|domain| Some(domain.as_str()))
            .collect()
    };

    // A JavaScript Map keeps the first insertion position and the last value.
    let mut order: Vec<String> = Vec::new();
    let mut seen: HashMap<String, BrowserCookie> = HashMap::new();
    for domain_filter in domain_filters {
        let mut options = BrowserCookieReadOptions::new(source.browser)
            .ignore_decryption_errors(true)
            .platform(source.platform)
            .home_dir(source.home_dir);
        if let Some(profile) = source.profile {
            options = options.profile(profile);
        }
        if let Some(domain) = domain_filter {
            options = options.domain_filter(domain);
        }
        for cookie in read_cookies(options)? {
            let key = format!("{}\0{}\0{}", cookie.domain, cookie.name, cookie.path);
            if !seen.contains_key(&key) {
                order.push(key.clone());
            }
            seen.insert(key, cookie);
        }
    }
    let cookies: Vec<BrowserCookie> = order.iter().filter_map(|key| seen.remove(key)).collect();

    let skipped = cookies
        .iter()
        .filter(|cookie| is_dbsc_bound_cookie(cookie))
        .map(|cookie| {
            MigrationEntry::new(
                "cookies",
                format!("{} {}", cookie.domain, cookie.name),
                "dbsc-bound",
            )
        })
        .collect();

    let mut warnings = Vec::new();
    if source
        .source_profile_dir
        .and_then(find_dbsc_registration)
        .is_some()
    {
        warnings.push(
            MigrationEntry::new(
                "cookies",
                "DeviceBoundSessions",
                "dbsc-registration-present",
            )
            .with_detail(DBSC_REGISTRATION_DETAIL),
        );
    }

    let outcome = ClassOutcome {
        migrated: cookies.len() as u64,
        skipped,
        warnings,
    };
    Ok((cookies, outcome))
}
