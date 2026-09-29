//! Mirrors `js/tests/unit/browser/migration/passwords.test.js`.

use std::path::Path;
use std::sync::Arc;

use rusqlite::{params, Connection};

use super::super::chromium_crypto::encrypt_chromium_value;
use super::super::passwords::{migrate_passwords, PasswordKeys};
use super::super::{ClassOutcome, SourceKeyResolver};
use super::fixtures::{
    assert_nothing_migrated, assert_source_unchanged, read_migrated_logins, TempDir,
};
use crate::browser::browser_cookie_crypto::derive_chromium_cookie_key;

struct LoginRow {
    origin_url: &'static str,
    username: &'static str,
    password_value: Vec<u8>,
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
