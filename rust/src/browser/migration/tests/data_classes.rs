//! Shared class names, consent guards and platform passkey reports.

use super::super::{migrate_profile, MigrateProfileOptions, MigrationSource, ALL_DATA_CLASSES};
use super::fixtures::TempDir;

#[test]
fn accepts_reports_from_the_original_six_class_schema() {
    let counts: super::super::MigratedCounts = serde_json::from_value(serde_json::json!({
        "cookies": 1, "bookmarks": 2, "history": 0,
        "passwords": 0, "preferences": 0, "extensions": 3,
    }))
    .unwrap();
    assert_eq!(counts.cookies, 1);
    assert_eq!(counts.extensions, 3);
    assert_eq!(counts.indexed_db, 0);
    assert_eq!(counts.payment_cards, 0);
}

#[test]
fn consented_cards_remain_explicitly_unsupported() {
    let source = TempDir::new("bc-data-classes-");
    let target = TempDir::new("bc-data-classes-");
    let report = migrate_profile(
        MigrateProfileOptions::new(
            MigrationSource::new("chrome").user_data_dir(source.path()),
            target.path().join("new-profile"),
        )
        .include(["paymentCards"])
        .include_payment_cards(true),
    )
    .unwrap();
    assert_eq!(report.migrated.payment_cards, 0);
    assert_eq!(report.skipped[0].reason, "data-class-not-supported");
}

#[test]
fn reports_each_additional_class_without_reading_card_data() {
    let classes: Vec<String> = serde_json::from_str(include_str!(
        "../../../../../tests/fixtures/migration-data-classes.json"
    ))
    .unwrap();
    for browser in ["chrome", "firefox", "safari"] {
        let source = TempDir::new("bc-data-classes-");
        let target_root = TempDir::new("bc-data-classes-");
        let target = target_root.path().join("new-profile");
        let profile = if browser == "chrome" {
            source.path().join("Default")
        } else {
            source.path().to_path_buf()
        };
        std::fs::create_dir_all(&profile).unwrap();
        let marker = b"protected card store must remain unread and unchanged";
        std::fs::write(profile.join("Web Data"), marker).unwrap();
        let report = migrate_profile(
            MigrateProfileOptions::new(
                MigrationSource::new(browser).user_data_dir(source.path()),
                &target,
            )
            .include(classes[6..].iter().cloned())
            .platform("darwin"),
        )
        .unwrap();
        assert_eq!(ALL_DATA_CLASSES.as_slice(), classes.as_slice());
        let value = serde_json::to_value(&report).unwrap();
        let counts = value["migrated"].as_object().unwrap();
        assert_eq!(counts.len(), classes.len());
        assert!(classes.iter().all(|name| counts[name] == 0));
        for class in &classes[6..] {
            assert!(report
                .skipped
                .iter()
                .any(|entry| &entry.data_class == class));
        }
        assert_eq!(
            report
                .skipped
                .iter()
                .find(|entry| entry.data_class == "paymentCards")
                .unwrap()
                .reason,
            "payment-card-consent-required"
        );
        let passkeys: Vec<_> = report
            .skipped
            .iter()
            .filter(|entry| entry.data_class == "passkeys")
            .collect();
        assert_eq!(
            passkeys
                .iter()
                .map(|entry| entry.item.as_str())
                .collect::<Vec<_>>(),
            [
                "iCloud Keychain",
                "Google Password Manager",
                "Windows Hello"
            ]
        );
        assert!(passkeys
            .iter()
            .all(|entry| entry.reason == "passkey-not-exportable"));
        assert!(passkeys.iter().all(|entry| entry
            .detail
            .as_ref()
            .unwrap()
            .contains("persistent profile")));
        assert!(!target.exists());
        assert_eq!(std::fs::read(profile.join("Web Data")).unwrap(), marker);
    }
}
