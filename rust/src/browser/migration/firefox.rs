//! Firefox to Chromium profile migration, mirroring
//! `js/src/browser/migration/firefox.js`.
//!
//! Firefox stores its data very differently from Chromium, so each data class
//! is translated rather than copied:
//!
//! - **cookies:** read from `cookies.sqlite` (`moz_cookies`, unencrypted) and
//!   returned in the same shape as the Chromium reader so the launcher can seed
//!   them over CDP.
//! - **bookmarks:** read from `places.sqlite` (`moz_bookmarks` + `moz_places`)
//!   and converted to Chrome's `Bookmarks` JSON.
//! - **history:** counted from `places.sqlite` and reported; it is not written,
//!   because Chrome's `History` schema is incompatible with Firefox's.
//! - **passwords:** decrypted from `logins.json` with the NSS key in `key4.db`
//!   and re-encrypted into a Chrome `Login Data`. When a primary password is
//!   set and not supplied, they are reported as `primary-password-set`.
//!
//! Every database is read through a consistent read-only snapshot, so a
//! running Firefox is never disturbed.

use std::fs;
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection};
use serde_json::Value;

use super::chromium_crypto::encrypt_chromium_value;
use super::firefox_bookmarks::{firefox_bookmarks_to_chrome, FirefoxBookmarkRow};
use super::firefox_nss::{
    decrypt_firefox_field, recover_firefox_key_from_database, PrimaryPasswordError,
};
use super::fs_utils::profile_file_if_present;
use super::sqlite_snapshot::read_database_snapshot;
use super::{ClassOutcome, MigrationEntry};
use crate::browser::browser_cookies::{read_firefox_cookies, BrowserCookie};

fn firefox_root(guid: Option<&str>) -> Option<String> {
    match guid? {
        "toolbar_____" => Some("toolbar".into()),
        "menu________" => Some("menu".into()),
        "unfiled_____" => Some("unfiled".into()),
        _ => None,
    }
}

/// A conservative Chrome `Login Data` schema. Chrome re-keys or upgrades this
/// on first launch; the columns below are the long-stable core of the `logins`
/// table plus the `meta` version marker.
const CHROME_LOGINS_SCHEMA: &str = "
CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
INSERT INTO meta (key, value) VALUES ('version', '34');
INSERT INTO meta (key, value) VALUES ('last_compatible_version', '1');
CREATE TABLE logins (
  origin_url VARCHAR NOT NULL,
  action_url VARCHAR,
  username_element VARCHAR,
  username_value VARCHAR,
  password_element VARCHAR,
  password_value BLOB,
  submit_element VARCHAR,
  signon_realm VARCHAR NOT NULL,
  date_created INTEGER NOT NULL,
  blacklisted_by_user INTEGER NOT NULL,
  scheme INTEGER NOT NULL,
  password_type INTEGER,
  times_used INTEGER,
  form_data BLOB,
  display_name VARCHAR,
  icon_url VARCHAR,
  federation_url VARCHAR,
  skip_zero_click INTEGER,
  generation_upload_status INTEGER,
  possible_username_pairs BLOB,
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date_last_used INTEGER NOT NULL DEFAULT 0,
  moving_blocked_for BLOB,
  date_password_modified INTEGER NOT NULL DEFAULT 0,
  UNIQUE (origin_url, username_element, username_value, password_element, signon_realm)
);
";

fn signon_realm(origin_url: &str) -> String {
    match url::Url::parse(origin_url) {
        Ok(url) => {
            let host = match (url.host_str(), url.port()) {
                (Some(host), Some(port)) => format!("{host}:{port}"),
                (Some(host), None) => host.to_string(),
                (None, _) => String::new(),
            };
            format!("{}://{host}/", url.scheme())
        }
        Err(_) => origin_url.to_string(),
    }
}

/// Read Firefox cookies from `cookies.sqlite` in the same shape as the
/// Chromium cookie reader, keeping hosts that contain any of `domains`.
pub(crate) fn read_firefox_profile_cookies(
    profile_dir: &Path,
    domains: &[String],
) -> Result<Vec<BrowserCookie>> {
    let Some(cookie_path) = profile_file_if_present(profile_dir, "cookies.sqlite") else {
        return Ok(Vec::new());
    };
    read_database_snapshot(&cookie_path, |database| {
        // The installed-browser cookie reader owns the row to cookie mapping,
        // so a migrated cookie and an imported one always have the same shape.
        let cookies = read_firefox_cookies(database, None)?;
        Ok(cookies
            .into_iter()
            .filter(|cookie| super::domains::matches_domains(&cookie.domain, domains))
            .collect())
    })
}

/// Convert Firefox bookmarks to a Chrome `Bookmarks` file in the target
/// profile.
pub(crate) fn migrate_firefox_bookmarks(
    profile_dir: &Path,
    target_profile_dir: &Path,
) -> Result<ClassOutcome> {
    let Some(places_path) = profile_file_if_present(profile_dir, "places.sqlite") else {
        return Ok(ClassOutcome::skipped(MigrationEntry::new(
            "bookmarks",
            "places.sqlite",
            "source-missing",
        )));
    };
    let rows = read_database_snapshot(&places_path, |database| {
        let mut statement = database.prepare(
            "SELECT b.id, b.parent, b.type, b.title, b.guid, p.url
               FROM moz_bookmarks b
               LEFT JOIN moz_places p ON b.fk = p.id
              ORDER BY b.parent, b.position",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(FirefoxBookmarkRow {
                id: row.get(0)?,
                parent: row.get(1)?,
                row_type: row.get(2)?,
                title: row.get(3)?,
                root: firefox_root(row.get::<_, Option<String>>(4)?.as_deref()),
                url: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    })?;
    let (document, count) = firefox_bookmarks_to_chrome(&rows);
    fs::create_dir_all(target_profile_dir)
        .with_context(|| format!("Could not create {}", target_profile_dir.display()))?;
    let target = target_profile_dir.join("Bookmarks");
    fs::write(&target, serde_json::to_string(&document)?)
        .with_context(|| format!("Could not write {}", target.display()))?;
    Ok(ClassOutcome::migrated(count))
}

/// Count Firefox history and report it (Chrome's schema is incompatible).
pub(crate) fn report_firefox_history(profile_dir: &Path) -> Result<ClassOutcome> {
    let Some(places_path) = profile_file_if_present(profile_dir, "places.sqlite") else {
        return Ok(ClassOutcome::default());
    };
    let count: i64 = read_database_snapshot(&places_path, |database| {
        Ok(database.query_row("SELECT COUNT(*) FROM moz_places", [], |row| row.get(0))?)
    })?;
    Ok(ClassOutcome {
        migrated: 0,
        skipped: vec![MigrationEntry::new(
            "history",
            "places.sqlite",
            "firefox-history-schema-incompatible",
        )],
        warnings: vec![MigrationEntry::new("history", "places.sqlite", "not-migrated")
            .with_detail(format!(
                "Firefox has {count} history entries; Chrome's History schema is incompatible, so history is reported but not converted."
            ))],
    })
}

/// The keys a Firefox password migration uses.
pub(crate) struct FirefoxPasswordKeys<'a> {
    pub platform: &'a str,
    /// The dedicated Chrome profile's key.
    pub target_key: &'a [u8],
    /// Version prefix to write; defaults to `v10` on Windows, `v11` elsewhere.
    pub target_prefix: Option<&'a str>,
    /// The Firefox primary password (empty when none is set).
    pub primary_password: &'a [u8],
}

pub(crate) struct DecryptedLogin {
    pub origin: Option<String>,
    pub username: String,
    pub password: String,
}

fn decrypt_login(login: &Value, key: &[u8]) -> Result<DecryptedLogin> {
    let field = |name: &str| -> Result<String> {
        let value = login
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("login has no {name}"))?;
        decrypt_firefox_field(value, key)
    };
    Ok(DecryptedLogin {
        origin: login
            .get("hostname")
            .and_then(Value::as_str)
            .map(str::to_string),
        username: field("encryptedUsername")?,
        password: field("encryptedPassword")?,
    })
}

/// Decrypt Firefox logins and write them into a Chrome `Login Data`.
#[cfg(test)]
pub(crate) fn migrate_firefox_passwords(
    profile_dir: &Path,
    target_profile_dir: &Path,
    keys: &FirefoxPasswordKeys<'_>,
) -> Result<ClassOutcome> {
    migrate_firefox_passwords_filtered(profile_dir, target_profile_dir, keys, &[])
}

pub(crate) fn migrate_firefox_passwords_filtered(
    profile_dir: &Path,
    target_profile_dir: &Path,
    keys: &FirefoxPasswordKeys<'_>,
    domains: &[String],
) -> Result<ClassOutcome> {
    let logins_path = profile_file_if_present(profile_dir, "logins.json");
    let key4_path = profile_file_if_present(profile_dir, "key4.db");
    let (Some(logins_path), Some(key4_path)) = (logins_path, key4_path) else {
        return Ok(ClassOutcome::skipped(MigrationEntry::new(
            "passwords",
            "logins.json",
            "source-missing",
        )));
    };
    if keys.target_key.is_empty() {
        return Err(anyhow!("migrate_firefox_passwords requires a target key"));
    }

    let key = match read_database_snapshot(&key4_path, |database| {
        recover_firefox_key_from_database(database, keys.primary_password)
    }) {
        Ok(key) => key,
        Err(error) if error.is::<PrimaryPasswordError>() => {
            return Ok(ClassOutcome::skipped(MigrationEntry::new(
                "passwords",
                "logins.json",
                "primary-password-set",
            )));
        }
        Err(error) => return Err(error),
    };

    let text = fs::read_to_string(&logins_path)
        .with_context(|| format!("Could not read {}", logins_path.display()))?;
    let document: Value = serde_json::from_str(&text)
        .with_context(|| format!("Could not parse {}", logins_path.display()))?;
    let logins = document
        .get("logins")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut outcome = ClassOutcome::default();
    let mut decrypted = Vec::new();
    for login in &logins {
        if !super::domains::matches_domains(
            login
                .get("hostname")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            domains,
        ) {
            continue;
        }
        match decrypt_login(login, &key) {
            Ok(entry) => decrypted.push(entry),
            Err(error) => outcome.skipped.push(
                MigrationEntry::new(
                    "passwords",
                    login
                        .get("hostname")
                        .and_then(Value::as_str)
                        .unwrap_or("(unknown)"),
                    "decrypt-failed",
                )
                .with_detail(format!("{error:#}")),
            ),
        }
    }

    outcome.migrated = write_chromium_passwords(target_profile_dir, &decrypted, keys)?;

    if outcome.migrated > 0 {
        outcome.warnings.push(
            MigrationEntry::new("passwords", "Login Data", "reencrypted-for-chrome").with_detail(
                format!(
                    "{} Firefox logins were decrypted and re-encrypted into a Chrome Login Data; Chrome may re-key the store on first launch.",
                    outcome.migrated
                ),
            ),
        );
    }
    Ok(outcome)
}

pub(crate) fn write_chromium_passwords(
    target_profile_dir: &Path,
    entries: &[DecryptedLogin],
    keys: &FirefoxPasswordKeys<'_>,
) -> Result<u64> {
    let mut migrated = 0;
    fs::create_dir_all(target_profile_dir)
        .with_context(|| format!("Could not create {}", target_profile_dir.display()))?;
    let target_path = target_profile_dir.join("Login Data");
    let database = Connection::open(&target_path)
        .with_context(|| format!("Could not open {}", target_path.display()))?;
    database.execute_batch(CHROME_LOGINS_SCHEMA)?;
    let target_prefix = keys.target_prefix.unwrap_or(if keys.platform == "win32" {
        "v10"
    } else {
        "v11"
    });
    {
        let mut insert = database.prepare(
            "INSERT OR IGNORE INTO logins (
               origin_url, action_url, username_element, username_value,
               password_element, password_value, submit_element, signon_realm,
               date_created, blacklisted_by_user, scheme, password_type, times_used,
               date_last_used, date_password_modified
             ) VALUES (?1, ?2, '', ?3, '', ?4, '', ?5, 0, 0, 0, 0, 0, 0, 0)",
        )?;
        for entry in entries {
            let encrypted = encrypt_chromium_value(
                entry.password.as_bytes(),
                keys.target_key,
                keys.platform,
                Some(target_prefix),
            )?;
            let realm = entry.origin.as_deref().map(signon_realm);
            insert.execute(params![
                entry.origin,
                entry.origin,
                entry.username,
                encrypted,
                realm
            ])?;
            migrated += 1;
        }
    }
    drop(database);

    Ok(migrated)
}
