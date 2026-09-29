//! Mirrors `js/tests/unit/browser/migration/extensions.test.js`.

use std::fs;
use std::path::Path;

use serde_json::json;

use super::super::extensions::{migrate_extensions, select_migratable_extensions};
use super::super::ClassOutcome;
use super::fixtures::{read_profile_json, write_profile_json, TempDir};

const USER_EXTENSION: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMPONENT_EXTENSION: &str = "cccccccccccccccccccccccccccccccc";

fn write_extension(profile_dir: &Path, id: &str, version: &str) {
    let dir = profile_dir.join("Extensions").join(id).join(version);
    fs::create_dir_all(&dir).unwrap();
    let manifest = json!({ "name": id, "version": version, "manifest_version": 3 });
    fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();
}

#[test]
fn excludes_policy_installed_and_component_extensions() {
    let settings = [
        ("user".to_string(), json!({ "location": 1 })),
        ("component".to_string(), json!({ "location": 5 })),
        ("policy".to_string(), json!({ "location": 7 })),
        ("external".to_string(), json!({ "location": 10 })),
    ];
    let selection = select_migratable_extensions(&settings);
    assert_eq!(selection.eligible, vec!["user".to_string()]);
    assert_eq!(selection.excluded.len(), 3);
    assert!(selection
        .excluded
        .iter()
        .all(|(_, reason)| reason == "policy-or-component-extension"));
}

#[test]
fn copies_eligible_extension_files_and_warns_about_the_mac() {
    let source = TempDir::new("bc-ext-");
    let target = TempDir::new("bc-ext-");
    write_extension(source.path(), USER_EXTENSION, "1.0");
    write_extension(source.path(), COMPONENT_EXTENSION, "2.0");
    write_profile_json(
        source.path(),
        "Secure Preferences",
        &json!({
            "extensions": {
                "settings": {
                    USER_EXTENSION: { "location": 1, "manifest": {} },
                    COMPONENT_EXTENSION: { "location": 5 },
                },
            },
        }),
    );

    let report = migrate_extensions(source.path(), target.path()).unwrap();

    assert_eq!(report.migrated, 1);
    assert!(report.skipped.iter().any(|entry| entry.item == COMPONENT_EXTENSION
        && entry.reason == "policy-or-component-extension"));
    assert_eq!(report.warnings[0].reason, "mac-will-not-validate");
    let copied = fs::read_to_string(
        target
            .path()
            .join("Extensions")
            .join(USER_EXTENSION)
            .join("1.0")
            .join("manifest.json"),
    )
    .unwrap();
    assert!(copied.contains("manifest_version"));
    let target_secure = read_profile_json(target.path(), "Secure Preferences");
    assert!(target_secure["extensions"]["settings"][USER_EXTENSION].is_object());
}

#[test]
fn falls_back_to_the_directory_listing_without_secure_preferences() {
    let source = TempDir::new("bc-ext-");
    let target = TempDir::new("bc-ext-");
    write_extension(source.path(), "dddddddddddddddddddddddddddddddd", "1.0");

    let report = migrate_extensions(source.path(), target.path()).unwrap();
    assert_eq!(report.migrated, 1);
}

#[test]
fn reports_nothing_when_there_is_no_extensions_directory() {
    let source = TempDir::new("bc-ext-");
    let target = TempDir::new("bc-ext-");
    let report = migrate_extensions(source.path(), target.path()).unwrap();
    assert_eq!(report, ClassOutcome::default());
}
