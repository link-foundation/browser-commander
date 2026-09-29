//! Mirrors `js/tests/unit/browser/migration/preferences.test.js`.

use serde_json::json;

use super::super::preferences::{
    merge_preference_subset, migrate_preferences, MIGRATED_PREFERENCE_PATHS,
};
use super::fixtures::{assert_nothing_migrated, read_profile_json, write_profile_json, TempDir};

#[test]
fn copies_only_the_documented_subset_and_skips_missing_paths() {
    let source = json!({
        "intl": { "accept_languages": "en-US,en" },
        "download": { "default_directory": "/home/alice/Downloads" },
        "homepage": "https://start.example/",
        "unrelated": { "setting": true },
    });
    let mut target = json!({});
    let migrated_paths = merge_preference_subset(&source, &mut target, &MIGRATED_PREFERENCE_PATHS);

    assert_eq!(target["intl"]["accept_languages"], "en-US,en");
    assert_eq!(target["homepage"], "https://start.example/");
    assert!(target.get("unrelated").is_none());
    assert!(migrated_paths.iter().any(|path| path == "intl.accept_languages"));
    assert!(migrated_paths.iter().any(|path| path == "homepage"));
}

#[test]
fn never_migrates_download_default_directory() {
    assert!(!MIGRATED_PREFERENCE_PATHS.contains(&"download.default_directory"));
    let source = json!({ "download": { "default_directory": "/tmp/dl" } });
    let mut target = json!({});
    merge_preference_subset(&source, &mut target, &MIGRATED_PREFERENCE_PATHS);
    assert!(target.get("download").is_none());
}

#[test]
fn merges_the_subset_into_an_existing_target_preferences() {
    let source = TempDir::new("bc-prefs-");
    let target = TempDir::new("bc-prefs-");
    write_profile_json(
        source.path(),
        "Preferences",
        &json!({
            "intl": { "accept_languages": "de-DE,de" },
            "download": { "default_directory": "/home/bob/Downloads" },
            "session": { "restore_on_startup": 4, "startup_urls": ["https://x/"] },
        }),
    );
    write_profile_json(
        target.path(),
        "Preferences",
        &json!({ "profile": { "name": "existing" } }),
    );

    let report = migrate_preferences(source.path(), target.path()).unwrap();

    assert!(report.migrated >= 2);
    let merged = read_profile_json(target.path(), "Preferences");
    assert_eq!(merged["intl"]["accept_languages"], "de-DE,de");
    assert_eq!(merged["session"]["restore_on_startup"], 4);
    assert_eq!(merged["profile"]["name"], "existing");
    assert!(merged.get("download").is_none());
}

#[test]
fn reports_a_skip_when_the_source_has_no_preferences() {
    let source = TempDir::new("bc-prefs-");
    let target = TempDir::new("bc-prefs-");
    let report = migrate_preferences(source.path(), target.path()).unwrap();
    assert_nothing_migrated(&report, "source-missing");
}
