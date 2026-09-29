//! Profile fixtures for the migration tests, mirroring
//! `js/tests/helpers/migration-fixtures.js` and
//! `js/tests/fixtures/firefox-nss-fixtures.mjs`.
//!
//! The NSS fixtures build `key4.db` and `logins.json` with the exact structures
//! (PBES2-wrapped keys, DER-wrapped 3DES login fields) the production decryptor
//! parses, so a green test proves the parser and the crypto agree.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use aes::Aes256;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cbc::cipher::block_padding::{NoPadding, Pkcs7};
use cbc::cipher::{BlockModeEncrypt, KeyIvInit};
use des::TdesEde3;
use pbkdf2::pbkdf2_hmac;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use sha2::Sha256;

use super::super::chromium_crypto::random_bytes;
use super::super::fs_utils::{make_temp_dir, remove_dir_quietly};
use super::super::ClassOutcome;
use crate::browser::browser_cookie_crypto::decrypt_chromium_cookie;

/// A temporary directory removed on drop.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new(prefix: &str) -> Self {
        Self(make_temp_dir(prefix).expect("temporary directory"))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        remove_dir_quietly(&self.0);
    }
}

/// Assert that a step migrated nothing, and why.
pub(crate) fn assert_nothing_migrated(outcome: &ClassOutcome, reason: &str) {
    assert_eq!(outcome.migrated, 0);
    assert_eq!(outcome.skipped[0].reason, reason);
}

fn modified(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .expect("source modification time")
}

/// Assert that `action` leaves a source file untouched.
pub(crate) fn assert_source_unchanged<T>(path: &Path, action: impl FnOnce() -> T) -> T {
    let before = modified(path);
    let result = action();
    assert_eq!(before, modified(path));
    result
}

pub(crate) fn write_profile_json(profile_dir: &Path, name: &str, value: &Value) {
    fs::write(profile_dir.join(name), value.to_string()).expect("write profile JSON");
}

pub(crate) fn read_profile_json(profile_dir: &Path, name: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(profile_dir.join(name)).expect("read profile JSON"))
        .expect("parse profile JSON")
}

/// Write a Chromium `History` database with `url_count` visited URLs.
pub(crate) fn write_chromium_history(profile_dir: &Path, url_count: usize) -> PathBuf {
    let history_path = profile_dir.join("History");
    let database = Connection::open(&history_path).expect("open History");
    database
        .execute_batch("CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT)")
        .expect("create urls");
    for index in 0..url_count {
        database
            .execute(
                "INSERT INTO urls (url, title) VALUES (?1, ?2)",
                params![
                    format!("https://example.com/{index}"),
                    format!("Page {index}")
                ],
            )
            .expect("insert url");
    }
    history_path
}

/// A `moz_cookies` row.
pub(crate) struct FirefoxCookieRow<'a> {
    pub name: &'a str,
    pub value: &'a str,
    pub host: &'a str,
    pub secure: bool,
}

/// Write a Firefox `cookies.sqlite` holding the given rows.
pub(crate) fn write_firefox_cookies(profile_dir: &Path, rows: &[FirefoxCookieRow<'_>]) {
    let database = Connection::open(profile_dir.join("cookies.sqlite")).expect("open cookies");
    database
        .execute_batch(
            "CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT,
               expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)",
        )
        .expect("create moz_cookies");
    for row in rows {
        database
            .execute(
                "INSERT INTO moz_cookies
                   (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite)
                 VALUES (?1, ?2, ?3, '/', 0, ?4, 0, 0)",
                params![row.name, row.value, row.host, i64::from(row.secure)],
            )
            .expect("insert cookie");
    }
}

/// Write a Firefox `places.sqlite` with a toolbar bookmark and, unless
/// `with_menu_bookmark` is false, a bookmarks-menu one.
pub(crate) fn write_firefox_places(profile_dir: &Path, with_menu_bookmark: bool) {
    let database = Connection::open(profile_dir.join("places.sqlite")).expect("open places");
    database
        .execute_batch(
            "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT);
             CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER,
               parent INTEGER, position INTEGER, title TEXT, guid TEXT);",
        )
        .expect("create places");
    let bookmark = |id: i64,
                    kind: i64,
                    fk: Option<i64>,
                    parent: i64,
                    position: i64,
                    title: &str,
                    guid: &str| {
        database
            .execute(
                "INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, guid)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, kind, fk, parent, position, title, guid],
            )
            .expect("insert bookmark");
    };
    let place = |id: i64, url: &str| {
        database
            .execute(
                "INSERT INTO moz_places (id, url) VALUES (?1, ?2)",
                params![id, url],
            )
            .expect("insert place");
    };
    bookmark(1, 2, None, 0, 0, "", "root________");
    bookmark(3, 2, None, 1, 0, "Bookmarks Toolbar", "toolbar_____");
    place(10, "https://toolbar.example/");
    bookmark(100, 1, Some(10), 3, 0, "Toolbar Site", "aaaaaaaaaaaa");
    if with_menu_bookmark {
        bookmark(2, 2, None, 1, 1, "Bookmarks Menu", "menu________");
        place(11, "https://menu.example/");
        bookmark(101, 1, Some(11), 2, 0, "Menu Site", "bbbbbbbbbbbb");
    }
}

const OID_PBES2: [u8; 9] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d];
const OID_PBKDF2: [u8; 9] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0c];
const OID_HMAC_SHA256: [u8; 8] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x02, 0x09];
const OID_AES_256_CBC: [u8; 9] = [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x01, 0x2a];
const OID_DES_EDE3_CBC: [u8; 8] = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x03, 0x07];
const CKA_ID: [u8; 16] = [0xf8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x01];

fn der_length(length: usize) -> Vec<u8> {
    if length < 0x80 {
        return vec![length as u8];
    }
    let bytes: Vec<u8> = length
        .to_be_bytes()
        .into_iter()
        .skip_while(|byte| *byte == 0)
        .collect();
    [vec![0x80 | bytes.len() as u8], bytes].concat()
}

pub(crate) fn der_element(tag: u8, content: &[u8]) -> Vec<u8> {
    [vec![tag], der_length(content.len()), content.to_vec()].concat()
}

pub(crate) fn der_sequence(parts: &[Vec<u8>]) -> Vec<u8> {
    der_element(0x30, &parts.concat())
}

pub(crate) fn der_octet(bytes: &[u8]) -> Vec<u8> {
    der_element(0x04, bytes)
}

pub(crate) fn der_oid(bytes: &[u8]) -> Vec<u8> {
    der_element(0x06, bytes)
}

fn der_integer(number: u32) -> Vec<u8> {
    let mut bytes: Vec<u8> = number
        .to_be_bytes()
        .into_iter()
        .skip_while(|byte| *byte == 0)
        .collect();
    if bytes.is_empty() {
        bytes.push(0);
    } else if bytes[0] & 0x80 != 0 {
        bytes.insert(0, 0);
    }
    der_element(0x02, &bytes)
}

fn encode_pbes2_blob(
    global_salt: &[u8],
    iterations: u32,
    plaintext: &[u8],
    primary_password: &[u8],
) -> Vec<u8> {
    let entry_salt = random_bytes(16).expect("salt");
    let iv14 = random_bytes(14).expect("iv");
    let password_hash = Sha1::new()
        .chain_update(global_salt)
        .chain_update(primary_password)
        .finalize();
    let mut key = [0_u8; 32];
    pbkdf2_hmac::<Sha256>(&password_hash, &entry_salt, iterations, &mut key);
    let iv = [&[0x04_u8, 0x0e][..], &iv14].concat();
    let ciphertext = cbc::Encryptor::<Aes256>::new_from_slices(&key, &iv)
        .expect("AES key")
        .encrypt_padded_vec::<Pkcs7>(plaintext);
    let kdf = der_sequence(&[
        der_oid(&OID_PBKDF2),
        der_sequence(&[
            der_octet(&entry_salt),
            der_integer(iterations),
            der_integer(32),
            der_sequence(&[der_oid(&OID_HMAC_SHA256)]),
        ]),
    ]);
    let encryption = der_sequence(&[der_oid(&OID_AES_256_CBC), der_octet(&iv14)]);
    let algorithm = der_sequence(&[der_oid(&OID_PBES2), der_sequence(&[kdf, encryption])]);
    der_sequence(&[algorithm, der_octet(&ciphertext)])
}

/// A Firefox `key4.db` fixture.
pub(crate) struct Key4Fixture {
    pub key4_path: PathBuf,
    pub login_key: Vec<u8>,
}

/// Build a Firefox `key4.db` with a PBES2-wrapped 3DES login key.
pub(crate) fn build_key4_database(dir: &Path, primary_password: &[u8]) -> Key4Fixture {
    let iterations = 100;
    let global_salt = random_bytes(16).expect("salt");
    let login_key = random_bytes(24).expect("login key");
    let check_blob = encode_pbes2_blob(
        &global_salt,
        iterations,
        b"password-check\x02\x02",
        primary_password,
    );
    let key_blob = encode_pbes2_blob(&global_salt, iterations, &login_key, primary_password);
    let key4_path = dir.join("key4.db");
    let database = Connection::open(&key4_path).expect("open key4.db");
    database
        .execute_batch(
            "CREATE TABLE metadata (id TEXT PRIMARY KEY, item1 BLOB, item2 BLOB);
             CREATE TABLE nssPrivate (a11 BLOB, a102 BLOB);",
        )
        .expect("create key4 tables");
    database
        .execute(
            "INSERT INTO metadata (id, item1, item2) VALUES ('password', ?1, ?2)",
            params![global_salt, check_blob],
        )
        .expect("insert metadata");
    database
        .execute(
            "INSERT INTO nssPrivate (a11, a102) VALUES (?1, ?2)",
            params![key_blob, CKA_ID.to_vec()],
        )
        .expect("insert nssPrivate");
    Key4Fixture {
        key4_path,
        login_key,
    }
}

/// Encode one NSS login field as base64, exactly like `logins.json` stores it.
pub(crate) fn encode_login_field(key: &[u8], plaintext: &str) -> String {
    let iv = random_bytes(8).expect("iv");
    let mut padded = plaintext.as_bytes().to_vec();
    let pad = 8 - padded.len() % 8;
    padded.extend(std::iter::repeat_n(pad as u8, pad));
    let ciphertext = cbc::Encryptor::<TdesEde3>::new_from_slices(key, &iv)
        .expect("3DES key")
        .encrypt_padded_vec::<NoPadding>(&padded);
    BASE64.encode(der_sequence(&[
        der_octet(&CKA_ID),
        der_sequence(&[der_oid(&OID_DES_EDE3_CBC), der_octet(&iv)]),
        der_octet(&ciphertext),
    ]))
}

/// Plaintext credentials for `logins.json`.
pub(crate) struct LoginEntry<'a> {
    pub hostname: &'a str,
    pub username: &'a str,
    pub password: &'a str,
}

/// Write a Firefox `key4.db` and a `logins.json` encrypted with its login key.
pub(crate) fn write_firefox_logins(
    profile_dir: &Path,
    entries: &[LoginEntry<'_>],
    primary_password: &[u8],
) -> Key4Fixture {
    let fixture = build_key4_database(profile_dir, primary_password);
    let logins: Vec<Value> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| {
            json!({
                "id": index + 1,
                "hostname": entry.hostname,
                "encryptedUsername": encode_login_field(&fixture.login_key, entry.username),
                "encryptedPassword": encode_login_field(&fixture.login_key, entry.password),
                "guid": format!("{{fixture-{index}}}"),
            })
        })
        .collect();
    let document = json!({ "nextId": entries.len() + 1, "logins": logins });
    fs::write(profile_dir.join("logins.json"), document.to_string()).expect("write logins.json");
    fixture
}

/// A login read back from a target `Login Data`.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct MigratedLogin {
    pub origin: String,
    pub username: String,
    pub password: String,
}

/// Read back the logins a migration wrote, decrypting each password with the
/// target profile's key (Linux `v10`/`v11` scheme), sorted by origin.
pub(crate) fn read_migrated_logins(
    target_profile_dir: &Path,
    target_key: &[u8],
) -> Vec<MigratedLogin> {
    let database =
        Connection::open(target_profile_dir.join("Login Data")).expect("open Login Data");
    let mut statement = database
        .prepare(
            "SELECT origin_url, username_value, password_value FROM logins ORDER BY origin_url",
        )
        .expect("prepare logins");
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Vec<u8>>(2)?,
            ))
        })
        .expect("query logins")
        .collect::<rusqlite::Result<Vec<_>>>()
        .expect("read logins");
    rows.into_iter()
        .map(|(origin, username, encrypted)| {
            let host = url::Url::parse(&origin)
                .ok()
                .and_then(|url| url.host_str().map(str::to_string))
                .unwrap_or_default();
            let password = decrypt_chromium_cookie(&encrypted, &host, 0, "linux", target_key)
                .expect("decrypt migrated password");
            MigratedLogin {
                origin,
                username,
                password,
            }
        })
        .collect()
}

/// A cookie with the given name and domain on `/`.
pub(crate) fn cookie(name: &str, domain: &str) -> crate::browser::browser_cookies::BrowserCookie {
    crate::browser::browser_cookies::BrowserCookie {
        name: name.to_string(),
        value: String::new(),
        domain: domain.to_string(),
        path: "/".to_string(),
        expires: -1,
        http_only: false,
        secure: false,
        same_site: "Lax".to_string(),
    }
}
