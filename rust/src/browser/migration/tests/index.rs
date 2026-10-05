//! Mirrors `js/tests/unit/browser/migration/index.test.js`, plus the JSON
//! shape the JavaScript report serialises to.

use std::sync::Arc;

// feature-parity: migration.profile@native-typed

use serde_json::json;

use super::super::{
    migrate_profile, MigrateProfileOptions, MigrationKeys, MigrationSource, ALL_DATA_CLASSES,
};
use super::fixtures::{
    cookie, read_migrated_logins, write_firefox_cookies, write_firefox_logins,
    write_firefox_places, write_firefox_profile, write_profile_json, FirefoxCookieRow, LoginEntry,
    TempDir,
};
use crate::browser::browser_cookie_crypto::derive_chromium_cookie_key;
use crate::browser::browser_sources::Environment;

fn firefox_source(dir: &std::path::Path) -> MigrationSource {
    MigrationSource::new("firefox").user_data_dir(dir)
}

fn example_cookie_row() -> [FirefoxCookieRow<'static>; 1] {
    [FirefoxCookieRow {
        name: "a",
        value: "1",
        host: ".example.com",
        secure: false,
    }]
}

#[test]
fn validates_required_options() {
    let error = migrate_profile(MigrateProfileOptions::new(
        MigrationSource::default(),
        "/tmp/x",
    ))
    .unwrap_err();
    assert!(error.to_string().contains("from.browser"));
    let error = migrate_profile(MigrateProfileOptions::new(
        MigrationSource::new("chrome"),
        "",
    ))
    .unwrap_err();
    assert!(error.to_string().contains("target directory"));
}

#[test]
fn migrates_a_firefox_source_and_returns_the_documented_report_shape() {
    let source = TempDir::new("bc-orch-");
    let target = TempDir::new("bc-orch-");
    write_firefox_cookies(source.path(), &example_cookie_row());
    write_firefox_places(source.path(), false);
    write_firefox_logins(
        source.path(),
        &[LoginEntry {
            hostname: "https://a.example",
            username: "alice",
            password: "pw",
        }],
        b"",
    );
    let target_key = derive_chromium_cookie_key("target-pass", "linux").unwrap();

    let report = migrate_profile(
        MigrateProfileOptions::new(firefox_source(source.path()), target.path())
            .platform("linux")
            .keys(MigrationKeys {
                target_key: Some(target_key.clone()),
                target_prefix: Some("v11".to_string()),
                ..MigrationKeys::default()
            }),
    )
    .unwrap();

    // Exact report shape.
    let value = serde_json::to_value(&report).unwrap();
    let mut keys: Vec<&str> = value["migrated"]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    let mut expected = ALL_DATA_CLASSES.to_vec();
    expected.sort_unstable();
    assert_eq!(keys, expected);
    assert_eq!(report.source.browser, "firefox");
    assert_eq!(report.target, target.path());
    assert!(value["skipped"].is_array());
    assert!(value["warnings"].is_array());

    assert_eq!(report.migrated.cookies, 1);
    assert_eq!(report.migrated.bookmarks, 1);
    assert_eq!(report.migrated.passwords, 1);
    // Firefox history cannot be migrated into Chrome's schema.
    assert_eq!(report.migrated.history, 0);
    assert_eq!(report.migrated.preferences, 0);
    assert_eq!(report.migrated.extensions, 0);

    // Cookies are returned for CDP seeding, not written to disk.
    assert_eq!(report.cookies[0].domain, ".example.com");
    assert_eq!(
        read_migrated_logins(target.path(), &target_key)[0].password,
        "pw"
    );
}

#[test]
fn honours_the_include_filter() {
    let source = TempDir::new("bc-orch-");
    let target = TempDir::new("bc-orch-");
    write_firefox_places(source.path(), false);
    write_firefox_cookies(source.path(), &example_cookie_row());

    let report = migrate_profile(
        MigrateProfileOptions::new(firefox_source(source.path()), target.path())
            .include(["bookmarks"])
            .platform("linux"),
    )
    .unwrap();

    assert_eq!(report.migrated.bookmarks, 1);
    assert_eq!(report.migrated.cookies, 0);
    assert!(!target.path().join("Login Data").exists());
}

#[test]
fn skips_passwords_with_a_warning_when_no_target_key_is_available_on_windows() {
    let source = TempDir::new("bc-orch-");
    let target = TempDir::new("bc-orch-");
    write_firefox_places(source.path(), false);

    let report = migrate_profile(
        MigrateProfileOptions::new(firefox_source(source.path()), target.path())
            .include(["passwords"])
            .platform("win32"),
    )
    .unwrap();

    assert_eq!(report.migrated.passwords, 0);
    assert!(report
        .skipped
        .iter()
        .any(|entry| entry.data_class == "passwords" && entry.reason == "target-key-unavailable"));
    assert_eq!(report.warnings[0].reason, "target-key-unavailable");
}

#[test]
fn reads_chromium_cookies_through_the_injected_reader() {
    let source = TempDir::new("bc-orch-");
    let target = TempDir::new("bc-orch-");
    let report = migrate_profile(
        MigrateProfileOptions::new(
            MigrationSource::new("chrome").user_data_dir(source.path()),
            target.path(),
        )
        .include(["cookies"])
        .domains(["google.com"])
        .platform("linux")
        .read_cookies(Arc::new(|options| {
            assert_eq!(options.domain_filter.as_deref(), Some("google.com"));
            Ok(vec![cookie("SID", ".google.com")])
        })),
    )
    .unwrap();
    assert_eq!(report.migrated.cookies, 1);

    let (cookies, summary) = report.into_parts();
    assert_eq!(cookies.len(), 1);
    let value = serde_json::to_value(&summary).unwrap();
    assert!(value.get("cookies").is_none());
    assert_eq!(
        value["source"],
        json!({ "browser": "chrome", "profile": "Default", "userDataDir": source.path() })
    );
    assert_eq!(value["migrated"]["cookies"], 1);
}

#[test]
fn serialises_entries_with_the_javascript_field_names() {
    let entry = super::super::MigrationEntry::new("passwords", "Login Data", "source-missing");
    assert_eq!(
        serde_json::to_value(&entry).unwrap(),
        json!({ "type": "passwords", "item": "Login Data", "reason": "source-missing" })
    );
    let entry = entry.with_detail("why");
    assert_eq!(serde_json::to_value(&entry).unwrap()["detail"], "why");
}

#[test]
fn imports_a_domain_from_whichever_installed_browser_holds_it() {
    let home = TempDir::new("bc-orch-");
    let target = TempDir::new("bc-orch-");
    write_firefox_profile(
        home.path(),
        &[FirefoxCookieRow {
            name: "a",
            value: "1",
            host: ".other.test",
            secure: false,
        }],
        ".mozilla/firefox",
        "default-release",
    );
    write_firefox_profile(
        home.path(),
        &[FirefoxCookieRow {
            name: "session",
            value: "s",
            host: ".github.com",
            secure: false,
        }],
        ".librewolf",
        "default",
    );

    let report = migrate_profile(
        MigrateProfileOptions::new(MigrationSource::new("default"), target.path())
            .include(["cookies"])
            .domains(["github.com"])
            .platform("linux")
            .home_dir(home.path())
            .environment(Environment::new())
            .run_command(Arc::new(|_: &str, _: &[&str], _: &Environment| {
                Ok("firefox.desktop\n".to_string())
            })),
    )
    .unwrap();

    assert_eq!(report.source.browser, "librewolf");
    assert_eq!(report.source.profile, "default");
    assert_eq!(report.migrated.cookies, 1);
    let reasons: Vec<&str> = report
        .warnings
        .iter()
        .map(|warning| warning.reason.as_str())
        .collect();
    assert_eq!(reasons, ["default-browser-fallback"]);
}

#[test]
fn reads_a_single_profile_chromium_browser_opera_from_its_root() {
    let home = TempDir::new("bc-orch-");
    let target = TempDir::new("bc-orch-");
    let root = home.path().join(".config").join("opera");
    std::fs::create_dir_all(&root).unwrap();
    write_profile_json(
        &root,
        "Bookmarks",
        &json!({
            "roots": {
                "bookmark_bar": {
                    "type": "folder",
                    "children": [{ "type": "url", "name": "A", "url": "https://a.example/" }],
                },
            },
        }),
    );

    let report = migrate_profile(
        MigrateProfileOptions::new(MigrationSource::new("opera"), target.path())
            .include(["bookmarks"])
            .platform("linux")
            .home_dir(home.path())
            .environment(Environment::new()),
    )
    .unwrap();

    assert_eq!(report.migrated.bookmarks, 1);
    assert!(report.skipped.is_empty());
}
