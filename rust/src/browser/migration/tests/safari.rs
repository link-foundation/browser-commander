//! Safari migration round trips use the same synthetic fixtures as JS/Python.

use std::path::Path;

use super::super::chromium_crypto::random_bytes;
use super::super::{migrate_profile, MigrateProfileOptions, MigrationKeys, MigrationSource};
use super::fixtures::{read_migrated_logins, TempDir};

#[test]
fn translates_safari_classes_and_encrypts_exported_passwords() {
    let source = TempDir::new("bc-safari-source-");
    let target = TempDir::new("bc-safari-target-");
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/safari-data");
    std::fs::copy(
        fixture.join("Bookmarks-binary.plist"),
        source.path().join("Bookmarks.plist"),
    )
    .unwrap();
    std::fs::copy(fixture.join("History.db"), source.path().join("History.db")).unwrap();
    let key = random_bytes(16).unwrap();
    let report = migrate_profile(
        MigrateProfileOptions::new(
            MigrationSource::new("safari").user_data_dir(source.path()),
            target.path(),
        )
        .include(["bookmarks", "history", "passwords"])
        .domains(["github.com"])
        .platform("linux")
        .password_csv(fixture.join("Passwords.csv"))
        .keys(MigrationKeys {
            target_key: Some(key.clone()),
            target_prefix: Some("v11".into()),
            ..MigrationKeys::default()
        }),
    )
    .unwrap();
    assert_eq!(report.migrated.bookmarks, 2);
    assert!(report
        .warnings
        .iter()
        .any(|entry| entry.reason == "safari-reading-list-translated"));
    assert_eq!(report.migrated.history, 2);
    assert_eq!(report.migrated.passwords, 1);
    assert!(report.skipped.is_empty());
    let logins = read_migrated_logins(target.path(), &key);
    assert_eq!(logins.len(), 1);
    assert_eq!(logins[0].password, "p\"a\nss");
}

#[test]
fn yandex_passman_has_specific_reason_before_credential_lookup() {
    let source = TempDir::new("bc-yandex-source-");
    let target = TempDir::new("bc-yandex-target-");
    let profile = source.path().join("Default");
    std::fs::create_dir(&profile).unwrap();
    let db = rusqlite::Connection::open(profile.join("Ya Passman Data")).unwrap();
    db.execute_batch("CREATE TABLE meta(key TEXT,value BLOB); INSERT INTO meta VALUES('local_encryptor_data',x'01')").unwrap();
    drop(db);
    let report = migrate_profile(
        MigrateProfileOptions::new(
            MigrationSource::new("yandex").user_data_dir(source.path()),
            target.path(),
        )
        .include(["passwords"]),
    )
    .unwrap();
    assert_eq!(report.migrated.passwords, 0);
    assert_eq!(
        report.skipped[0].reason,
        "yandex-passman-encryption-unsupported"
    );
}

#[test]
fn invalid_options_and_overlapping_paths_leave_targets_untouched() {
    let source = TempDir::new("bc-validate-source-");
    let target = TempDir::new("bc-validate-target-");
    for options in [
        MigrateProfileOptions::new(MigrationSource::new("chrome"), target.path())
            .include(["invented"]),
        MigrateProfileOptions::new(MigrationSource::new("chrome"), target.path())
            .domains(["https://example.com"]),
        MigrateProfileOptions::new(MigrationSource::new("chrome"), target.path())
            .target_browser("firefox"),
        MigrateProfileOptions::new(
            MigrationSource::new("opera").user_data_dir(source.path()),
            source.path(),
        )
        .include(["bookmarks"]),
    ] {
        assert!(migrate_profile(options).is_err());
        assert_eq!(std::fs::read_dir(target.path()).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(source.path()).unwrap().count(), 0);
    }
}
