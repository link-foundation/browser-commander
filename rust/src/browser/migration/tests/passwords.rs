//! Mirrors `js/tests/unit/browser/migration/passwords.test.js`.

use std::path::Path;
use std::sync::Arc;

use rusqlite::{params, Connection};

use super::super::chromium_crypto::{encrypt_chromium_value, random_bytes};
use super::super::passwords::{migrate_passwords, migrate_passwords_filtered, PasswordKeys};
use super::super::{
    migrate_profile, ClassOutcome, MigrateProfileOptions, MigrationKeys, MigrationSource,
    SourceKeyResolver,
};
use super::fixtures::{
    assert_nothing_migrated, assert_source_unchanged, read_migrated_logins, TempDir,
};
use crate::browser::browser_cookie_crypto::{decrypt_chromium_cookie, derive_chromium_cookie_key};

#[test]
fn filters_associated_metadata_and_reencrypts_retained_notes() {
    verify_login_metadata(&["github.com".into()]);
}

#[test]
fn preserves_unfiltered_metadata_and_reencrypts_all_retained_notes() {
    verify_login_metadata(&[]);
}

fn verify_login_metadata(domains: &[String]) {
    let filtered = !domains.is_empty();
    let source = TempDir::new("bc-password-metadata-");
    let target = TempDir::new("bc-password-metadata-");
    let key = random_bytes(16).unwrap();
    let target_key = random_bytes(16).unwrap();
    let database = Connection::open(source.path().join("Login Data")).unwrap();
    database
        .execute_batch(include_str!(
            "../../../../../tests/fixtures/password-domain-isolation.sql"
        ))
        .unwrap();
    let password = encrypt_chromium_value(b"password", &key, "linux", Some("v11")).unwrap();
    let note =
        encrypt_chromium_value("private note ☃".as_bytes(), &key, "linux", Some("v11")).unwrap();
    database
        .execute(
            "UPDATE logins SET password_value=? WHERE id IN (7,8)",
            [&password],
        )
        .unwrap();
    database
        .execute(
            "UPDATE password_notes SET value=? WHERE id IN (70,71,72)",
            [&note],
        )
        .unwrap();
    drop(database);
    let resolver: SourceKeyResolver = Arc::new(move |_| Ok(key.clone()));
    let report = assert_source_unchanged(&source.path().join("Login Data"), || {
        migrate_passwords_filtered(
            source.path(),
            target.path(),
            &PasswordKeys {
                platform: "linux",
                resolve_source_key: &resolver,
                target_key: &target_key,
                target_prefix: Some("v11"),
            },
            domains,
        )
        .unwrap()
    });
    assert_eq!(report.migrated, if filtered { 1 } else { 2 });
    let database = Connection::open(target.path().join("Login Data")).unwrap();
    let parents: Vec<Option<i64>> = database
        .prepare("SELECT parent_id FROM insecure_credentials")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        parents,
        if filtered {
            vec![Some(7)]
        } else {
            vec![Some(7), Some(8)]
        }
    );
    assert_eq!(
        database
            .query_row("SELECT origin_domain FROM stats", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "https://github.com"
    );
    assert_eq!(
        database
            .query_row("SELECT count(*) FROM stats", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        if filtered { 1 } else { 2 }
    );
    assert_eq!(
        database
            .query_row("SELECT count(*) FROM password_notes", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        if filtered { 1 } else { 2 }
    );
    let (id, value, created, confidential): (i64, Vec<u8>, i64, i64) = database
        .query_row(
            "SELECT id,value,date_created,confidential FROM password_notes",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!((id, created, confidential), (70, 123, 1));
    assert_eq!(
        decrypt_chromium_cookie(&value, "", 0, "linux", &target_key).unwrap(),
        "private note ☃"
    );
    if !filtered {
        let value: Vec<u8> = database
            .query_row("SELECT value FROM password_notes WHERE id=71", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            decrypt_chromium_cookie(&value, "", 0, "linux", &target_key).unwrap(),
            "private note ☃"
        );
    }
    for table in [
        "sync_entities_metadata",
        "sync_model_metadata",
        "future_password_metadata",
    ] {
        let preserved = table == "future_password_metadata" && !filtered;
        assert_eq!(
            database
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            i64::from(preserved)
        );
        assert_eq!(
            report.warnings.iter().any(|entry| entry.item == table),
            !preserved
        );
    }
    assert!(report
        .skipped
        .iter()
        .any(|entry| entry.item == "password_notes/73" && entry.reason == "app-bound-v20"));
    drop(database);
    let bytes = std::fs::read(target.path().join("Login Data")).unwrap();
    for marker in [b"unrelated-sync-marker".as_slice(), &note] {
        assert!(!bytes.windows(marker.len()).any(|part| part == marker));
    }
    assert_eq!(
        bytes
            .windows(b"unrelated-future-marker".len())
            .any(|part| part == b"unrelated-future-marker"),
        !filtered
    );
}

struct LoginRow {
    origin_url: &'static str,
    username: &'static str,
    password_value: Vec<u8>,
}

#[test]
fn yandex_keeps_supported_logins_beside_unsupported_passman() {
    let source = TempDir::new("bc-yandex-logins-");
    let target = TempDir::new("bc-yandex-target-");
    let profile = source.path().join("Default");
    std::fs::create_dir(&profile).unwrap();
    let passman = profile.join("Ya Passman Data");
    std::fs::write(&passman, b"unsupported-store").unwrap();
    let key = random_bytes(16).unwrap();
    let target_key = random_bytes(16).unwrap();
    write_login_data(
        &profile,
        &[encrypted_login(
            "https://example.com",
            "alice",
            "retained-password",
            &key,
            "v11",
        )],
    );
    let original = std::fs::read(profile.join("Login Data")).unwrap();
    let report = assert_source_unchanged(&profile.join("Login Data"), || {
        migrate_profile(
            MigrateProfileOptions::new(
                MigrationSource::new("yandex").user_data_dir(source.path()),
                target.path(),
            )
            .include(["passwords"])
            .platform("linux")
            .keys(MigrationKeys {
                target_key: Some(target_key.clone()),
                resolve_source_key: Some(Arc::new(move |_| Ok(key.clone()))),
                ..MigrationKeys::default()
            }),
        )
        .unwrap()
    });
    assert_eq!(report.migrated.passwords, 1);
    assert_eq!(
        report.skipped[0].reason,
        "yandex-passman-encryption-unsupported"
    );
    assert_eq!(
        read_migrated_logins(target.path(), &target_key)[0].password,
        "retained-password"
    );
    assert_eq!(std::fs::read(passman).unwrap(), b"unsupported-store");
    assert_eq!(std::fs::read(profile.join("Login Data")).unwrap(), original);
}

#[test]
fn filters_domains_and_removes_undecryptable_ciphertext_from_target() {
    let source = TempDir::new("bc-password-domain-");
    let target = TempDir::new("bc-password-domain-");
    let key = random_bytes(16).unwrap();
    write_login_data(
        source.path(),
        &[
            encrypted_login("https://github.com", "selected", "secret", &key, "v11"),
            LoginRow {
                origin_url: "https://notgithub.com",
                username: "unrelated",
                password_value: b"v20unreadable".to_vec(),
            },
            LoginRow {
                origin_url: "https://locked.github.com",
                username: "locked",
                password_value: b"v20unreadable".to_vec(),
            },
        ],
    );
    let source_key = key.clone();
    let resolver: SourceKeyResolver = Arc::new(move |_| Ok(source_key.clone()));
    let report = assert_source_unchanged(&source.path().join("Login Data"), || {
        migrate_passwords_filtered(
            source.path(),
            target.path(),
            &PasswordKeys {
                platform: "linux",
                resolve_source_key: &resolver,
                target_key: &key,
                target_prefix: Some("v11"),
            },
            &["github.com".into()],
        )
        .unwrap()
    });
    assert_eq!(report.migrated, 1);
    assert_eq!(read_migrated_logins(target.path(), &key).len(), 1);
    let bytes = std::fs::read(target.path().join("Login Data")).unwrap();
    assert!(!bytes
        .windows(b"v20unreadable".len())
        .any(|part| part == b"v20unreadable"));
}

fn write_login_data(dir: &Path, rows: &[LoginRow]) {
    let database = Connection::open(dir.join("Login Data")).unwrap();
    database
        .execute_batch(
            "CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB)",
        )
        .unwrap();
    for row in rows {
        database
            .execute(
                "INSERT INTO logins (origin_url, username_value, password_value) VALUES (?1, ?2, ?3)",
                params![row.origin_url, row.username, row.password_value],
            )
            .unwrap();
    }
}

/// A source login whose password is encrypted with the Linux source key.
fn encrypted_login(
    origin_url: &'static str,
    username: &'static str,
    plaintext: &str,
    key: &[u8],
    prefix: &str,
) -> LoginRow {
    LoginRow {
        origin_url,
        username,
        password_value: encrypt_chromium_value(plaintext.as_bytes(), key, "linux", Some(prefix))
            .unwrap(),
    }
}

/// Migrate on Linux, decrypting the source with `source_key`.
fn migrate_linux_passwords(
    source: &Path,
    target: &Path,
    source_key: Vec<u8>,
    target_key: &[u8],
    target_prefix: Option<&str>,
) -> ClassOutcome {
    let resolve_source_key: SourceKeyResolver = Arc::new(move |_| Ok(source_key.clone()));
    migrate_passwords(
        source,
        target,
        &PasswordKeys {
            platform: "linux",
            resolve_source_key: &resolve_source_key,
            target_key,
            target_prefix,
        },
    )
    .unwrap()
}

#[test]
fn re_encrypts_each_password_for_the_target_key_on_linux() {
    let source = TempDir::new("bc-pw-src-");
    let target = TempDir::new("bc-pw-dst-");
    let source_key = derive_chromium_cookie_key("source-pass", "linux").unwrap();
    let target_key = derive_chromium_cookie_key("target-pass", "linux").unwrap();
    write_login_data(
        source.path(),
        &[
            encrypted_login(
                "https://a.example/login",
                "alice",
                "secret-A",
                &source_key,
                "v11",
            ),
            encrypted_login(
                "https://b.example/login",
                "bob",
                "secret-B",
                &source_key,
                "v10",
            ),
        ],
    );

    let report = migrate_linux_passwords(
        source.path(),
        target.path(),
        source_key,
        &target_key,
        Some("v11"),
    );

    assert_eq!(report.migrated, 2);
    assert!(report.skipped.is_empty());
    let decrypted: Vec<String> = read_migrated_logins(target.path(), &target_key)
        .into_iter()
        .map(|login| login.password)
        .collect();
    assert_eq!(decrypted, vec!["secret-A", "secret-B"]);
}

#[test]
fn reports_app_bound_v20_passwords_as_skipped() {
    let source = TempDir::new("bc-pw-src-");
    let target = TempDir::new("bc-pw-dst-");
    let target_key = derive_chromium_cookie_key("target-pass", "linux").unwrap();
    write_login_data(
        source.path(),
        &[LoginRow {
            origin_url: "https://locked.example/login",
            username: "carol",
            password_value: [b"v20".as_slice(), &[1_u8; 32]].concat(),
        }],
    );

    let report = migrate_linux_passwords(
        source.path(),
        target.path(),
        target_key.clone(),
        &target_key,
        None,
    );

    assert_nothing_migrated(&report, "app-bound-v20");
}

#[test]
fn never_modifies_the_source_login_data() {
    let source = TempDir::new("bc-pw-src-");
    let target = TempDir::new("bc-pw-dst-");
    let key = derive_chromium_cookie_key("pw", "linux").unwrap();
    write_login_data(
        source.path(),
        &[encrypted_login(
            "https://a.example/login",
            "a",
            "x",
            &key,
            "v11",
        )],
    );

    assert_source_unchanged(&source.path().join("Login Data"), || {
        migrate_linux_passwords(source.path(), target.path(), key.clone(), &key, None)
    });
}

#[test]
fn reports_a_skip_when_there_is_no_login_data() {
    let source = TempDir::new("bc-pw-src-");
    let target = TempDir::new("bc-pw-dst-");
    let report = migrate_linux_passwords(source.path(), target.path(), vec![0; 16], &[0; 16], None);
    assert_nothing_migrated(&report, "source-missing");
}
