//! Mirrors `js/tests/unit/browser/migration/cookies.test.js`.

use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

use super::super::cookies::{
    is_dbsc_bound_cookie, migrate_cookies, CookieReader, CookieSource, DBSC_BOUND_COOKIE_NAMES,
};
use super::fixtures::{cookie, TempDir};
use crate::browser::browser_cookies::{BrowserCookie, BrowserCookieReadOptions};

fn source<'a>(domains: &'a [String], source_profile_dir: Option<&'a Path>) -> CookieSource<'a> {
    CookieSource {
        browser: "chrome",
        profile: None,
        source_profile_dir,
        domains,
        platform: "linux",
        home_dir: Path::new("/home/test"),
    }
}

fn reader(
    read: impl Fn(&BrowserCookieReadOptions) -> Vec<BrowserCookie> + Send + Sync + 'static,
) -> CookieReader {
    Arc::new(move |options| Ok(read(&options)))
}

#[test]
fn flags_rotating_google_session_token_cookies() {
    for name in DBSC_BOUND_COOKIE_NAMES {
        assert!(is_dbsc_bound_cookie(&cookie(name, ".google.com")), "{name}");
    }
    assert!(!is_dbsc_bound_cookie(&cookie("SID", ".google.com")));
    assert!(!is_dbsc_bound_cookie(&cookie("__Secure-1PSIDTS", ".example.com")));
}

#[test]
fn dedupes_across_domain_filters_and_tags_dbsc_bound_cookies() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&calls);
    let read_cookies = reader(move |options| {
        recorded.lock().unwrap().push(options.domain_filter.clone());
        if options.domain_filter.as_deref() == Some("google.com") {
            vec![cookie("__Secure-1PSIDTS", ".google.com"), cookie("SID", ".google.com")]
        } else {
            vec![cookie("session", ".example.com")]
        }
    });
    let domains = vec!["google.com".to_string(), "example.com".to_string()];

    let (cookies, report) = migrate_cookies(&source(&domains, None), &read_cookies).unwrap();

    assert_eq!(
        *calls.lock().unwrap(),
        vec![Some("google.com".to_string()), Some("example.com".to_string())]
    );
    assert_eq!(cookies.len(), 3);
    assert_eq!(report.migrated, 3);
    assert_eq!(report.skipped.len(), 1);
    assert_eq!(report.skipped[0].reason, "dbsc-bound");
}

#[test]
fn warns_when_the_source_has_a_dbsc_registration_database() {
    let profile = TempDir::new("bc-cookies-");
    fs::create_dir_all(profile.path().join("Network")).unwrap();
    fs::write(profile.path().join("Network").join("DeviceBoundSessions"), "x").unwrap();
    let read_cookies = reader(|_| vec![cookie("a", ".example.com")]);

    let (_, report) = migrate_cookies(&source(&[], Some(profile.path())), &read_cookies).unwrap();

    assert_eq!(report.warnings.len(), 1);
    assert_eq!(report.warnings[0].reason, "dbsc-registration-present");
}

#[test]
fn passes_ignore_decryption_errors_to_the_reader() {
    let seen = Arc::new(Mutex::new(None));
    let recorded = Arc::clone(&seen);
    let read_cookies = reader(move |options| {
        *recorded.lock().unwrap() = Some(options.ignore_decryption_errors);
        Vec::new()
    });

    migrate_cookies(&source(&[], None), &read_cookies).unwrap();

    assert_eq!(*seen.lock().unwrap(), Some(true));
}
