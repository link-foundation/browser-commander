//! Mirrors `js/tests/unit/browser/migration/firefox.test.js`.

use std::path::Path;

use super::super::firefox::{
    migrate_firefox_bookmarks, migrate_firefox_passwords, read_firefox_profile_cookies,
    report_firefox_history, FirefoxPasswordKeys,
};
use super::super::ClassOutcome;
use super::fixtures::{
    assert_nothing_migrated, read_migrated_logins, read_profile_json, write_firefox_cookies,
    write_firefox_logins, write_firefox_places, FirefoxCookieRow, LoginEntry, TempDir,
};
use crate::browser::browser_cookie_crypto::derive_chromium_cookie_key;

fn migrate_linux_passwords(source: &Path, target: &Path, target_key: &[u8]) -> ClassOutcome {
    migrate_firefox_passwords(
        source,
        target,
        &FirefoxPasswordKeys {
            platform: "linux",
            target_key,
            target_prefix: Some("v11"),
            primary_password: b"",
        },
    )
    .unwrap()
}

#[test]
fn reads_and_maps_cookies_applying_the_domain_filter() {
    let dir = TempDir::new("bc-ff-");
    write_firefox_cookies(
        dir.path(),
        &[
            FirefoxCookieRow {
                name: "a",
                value: "1",
                host: ".example.com",
                secure: true,
            },
            FirefoxCookieRow {
                name: "b",
                value: "2",
                host: ".other.com",
                secure: false,
            },
        ],
    );
    assert_eq!(
        read_firefox_profile_cookies(dir.path(), &[]).unwrap().len(),
        2
    );
    let filtered = read_firefox_profile_cookies(dir.path(), &["example.com".to_string()]).unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].domain, ".example.com");
    assert!(filtered[0].secure);
}

#[test]
fn returns_an_empty_list_when_there_is_no_cookies_sqlite() {
    let dir = TempDir::new("bc-ff-");
    assert!(read_firefox_profile_cookies(dir.path(), &[])
        .unwrap()
        .is_empty());
}

#[test]
fn converts_places_bookmarks_into_a_chrome_bookmarks_document() {
    let source = TempDir::new("bc-ff-");
    let target = TempDir::new("bc-ff-");
    write_firefox_places(source.path(), true);

    let report = migrate_firefox_bookmarks(source.path(), target.path()).unwrap();

    assert_eq!(report.migrated, 2);
    let document = read_profile_json(target.path(), "Bookmarks");
    assert_eq!(
        document["roots"]["bookmark_bar"]["children"][0]["url"],
        "https://toolbar.example/"
    );
    assert_eq!(
        document["roots"]["other"]["children"][0]["url"],
        "https://menu.example/"
    );
}

#[test]
fn counts_places_history_and_reports_it_as_not_migrated() {
    let source = TempDir::new("bc-ff-");
    write_firefox_places(source.path(), true);

    let report = report_firefox_history(source.path()).unwrap();

    assert_nothing_migrated(&report, "firefox-history-schema-incompatible");
    assert!(report.warnings[0]
        .detail
        .as_deref()
        .unwrap()
        .contains("2 history entries"));
}

#[test]
fn decrypts_logins_and_re_encrypts_them_into_a_chrome_login_data() {
    let source = TempDir::new("bc-ff-");
    let target = TempDir::new("bc-ff-");
    let fixture = write_firefox_logins(
        source.path(),
        &[LoginEntry {
            hostname: "https://a.example",
            username: "alice",
            password: "secret-A",
        }],
        b"",
    );
    assert_eq!(fixture.key4_path, source.path().join("key4.db"));
    let target_key = derive_chromium_cookie_key("target-pass", "linux").unwrap();

    let report = migrate_linux_passwords(source.path(), target.path(), &target_key);

    assert_eq!(report.migrated, 1);
    let logins = read_migrated_logins(target.path(), &target_key);
    assert_eq!(logins[0].username, "alice");
    assert_eq!(logins[0].password, "secret-A");
}

#[test]
fn reports_primary_password_set_when_the_key_is_locked() {
    let source = TempDir::new("bc-ff-");
    let target = TempDir::new("bc-ff-");
    write_firefox_logins(
        source.path(),
        &[LoginEntry {
            hostname: "https://a.example",
            username: "a",
            password: "b",
        }],
        b"locked",
    );
    let target_key = derive_chromium_cookie_key("t", "linux").unwrap();
    let report = migrate_linux_passwords(source.path(), target.path(), &target_key);
    assert_nothing_migrated(&report, "primary-password-set");
}

#[test]
fn reports_source_missing_when_there_is_no_logins_json() {
    let source = TempDir::new("bc-ff-");
    let target = TempDir::new("bc-ff-");
    let target_key = derive_chromium_cookie_key("t", "linux").unwrap();
    let report = migrate_linux_passwords(source.path(), target.path(), &target_key);
    assert_nothing_migrated(&report, "source-missing");
}
