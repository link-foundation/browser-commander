//! Saved-password migration, mirroring `js/src/browser/migration/passwords.js`.
//!
//! Chrome stores saved passwords in the `Login Data` SQLite database, in the
//! `logins` table, with `password_value` encrypted exactly like a cookie's
//! `encrypted_value` (the same OSCrypt keys), except that `Login Data` values
//! never carry the SHA-256(host) domain-hash prefix.
//!
//! Passwords cannot be re-seeded over CDP the way cookies can, so the migration
//! writes a target `Login Data` directly:
//!
//! 1. Take a consistent, read-only snapshot of the source `Login Data` with the
//!    SQLite Online Backup API.
//! 2. Copy that snapshot to the target path, which preserves Chrome's exact
//!    schema verbatim.
//! 3. Decrypt each `password_value` with the source profile's key and
//!    re-encrypt it with the dedicated target profile's key, in place.
//!
//! Windows app-bound `v20` values cannot be decrypted outside the browser and
//! are reported in `skipped` rather than failing the migration.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, Connection};

use super::chromium_crypto::encrypt_chromium_value;
use super::fs_utils::path_exists;
use super::os_crypt_keys::SourceKeyResolver;
use super::sqlite_snapshot::with_database_snapshot;
use super::{ClassOutcome, MigrationEntry};
use crate::browser::browser_cookie_crypto::decrypt_chromium_cookie;

/// The keys a Chromium password migration uses.
pub(crate) struct PasswordKeys<'a> {
    pub platform: &'a str,
    pub resolve_source_key: &'a SourceKeyResolver,
    pub target_key: &'a [u8],
    pub target_prefix: Option<&'a str>,
}

fn to_bytes(value: SqlValue) -> Vec<u8> {
    match value {
        SqlValue::Blob(bytes) => bytes,
        SqlValue::Text(text) => text.into_bytes(),
        SqlValue::Integer(number) => number.to_string().into_bytes(),
        SqlValue::Real(number) => number.to_string().into_bytes(),
        SqlValue::Null => Vec::new(),
    }
}

fn host_from_origin(origin: Option<&str>) -> String {
    let origin = origin.unwrap_or_default();
    url::Url::parse(origin)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_else(|| origin.to_string())
}

struct LoginRow {
    rowid: i64,
    origin_url: Option<String>,
    password_value: Vec<u8>,
}

fn reencrypt_logins(database: &Connection, keys: &PasswordKeys<'_>) -> Result<ClassOutcome> {
    let rows = {
        let mut statement =
            database.prepare("SELECT rowid, origin_url, password_value FROM logins")?;
        let mapped = statement.query_map([], |row| {
            Ok(LoginRow {
                rowid: row.get(0)?,
                origin_url: row.get(1)?,
                password_value: to_bytes(row.get(2)?),
            })
        })?;
        mapped.collect::<rusqlite::Result<Vec<_>>>()?
    };
    let target_prefix = keys.target_prefix.unwrap_or(if keys.platform == "win32" {
        "v10"
    } else {
        "v11"
    });
    let mut outcome = ClassOutcome::default();
    for row in rows {
        if row.password_value.is_empty() {
            continue;
        }
        let item = row.origin_url.as_deref().unwrap_or("(unknown)");
        let prefix =
            String::from_utf8_lossy(&row.password_value[..row.password_value.len().min(3)])
                .into_owned();
        if prefix == "v20" {
            outcome
                .skipped
                .push(MigrationEntry::new("passwords", item, "app-bound-v20"));
            continue;
        }
        if prefix != "v10" && prefix != "v11" {
            outcome.skipped.push(MigrationEntry::new(
                "passwords",
                item,
                "unsupported-encryption",
            ));
            continue;
        }
        let decrypted = (keys.resolve_source_key)(&prefix).and_then(|key| {
            decrypt_chromium_cookie(
                &row.password_value,
                &host_from_origin(row.origin_url.as_deref()),
                0,
                keys.platform,
                &key,
            )
        });
        let plaintext = match decrypted {
            Ok(plaintext) => plaintext,
            Err(error) => {
                outcome.skipped.push(
                    MigrationEntry::new("passwords", item, "decrypt-failed")
                        .with_detail(format!("{error:#}")),
                );
                continue;
            }
        };
        let reencrypted = encrypt_chromium_value(
            plaintext.as_bytes(),
            keys.target_key,
            keys.platform,
            Some(target_prefix),
        )?;
        database.execute(
            "UPDATE logins SET password_value = ?1 WHERE rowid = ?2",
            params![reencrypted, row.rowid],
        )?;
        outcome.migrated += 1;
    }
    Ok(outcome)
}

/// Migrate saved passwords into the target profile's `Login Data`.
pub(crate) fn migrate_passwords(
    source_profile_dir: &Path,
    target_profile_dir: &Path,
    keys: &PasswordKeys<'_>,
) -> Result<ClassOutcome> {
    let source_path = source_profile_dir.join("Login Data");
    if !path_exists(&source_path) {
        return Ok(ClassOutcome::skipped(MigrationEntry::new(
            "passwords",
            "Login Data",
            "source-missing",
        )));
    }
    if keys.target_key.is_empty() {
        return Err(anyhow::anyhow!(
            "migrate_passwords requires a target encryption key"
        ));
    }
    fs::create_dir_all(target_profile_dir)
        .with_context(|| format!("Could not create {}", target_profile_dir.display()))?;
    let target_path = target_profile_dir.join("Login Data");
    with_database_snapshot(&source_path, |snapshot_path| {
        // The snapshot copy preserves Chrome's exact schema; re-encrypt values
        // in place so the target keeps whatever schema version Chrome wrote.
        fs::copy(snapshot_path, &target_path)
            .with_context(|| format!("Could not write {}", target_path.display()))?;
        let database = Connection::open(&target_path)
            .with_context(|| format!("Could not open {}", target_path.display()))?;
        reencrypt_logins(&database, keys)
    })
}
