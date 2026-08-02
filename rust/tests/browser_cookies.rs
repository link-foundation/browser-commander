use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use aes::Aes128;
use browser_commander::{
    list_browser_profiles, read_browser_cookies, BrowserCookieReadOptions, BrowserProfileOptions,
};
use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use rusqlite::{params, Connection};
use sha1::Sha1;
use sha2::{Digest, Sha256};

const CHROME_EPOCH_OFFSET_SECONDS: i64 = 11_644_473_600;

type Aes128CbcEncryptor = cbc::Encryptor<Aes128>;

#[test]
fn discovers_and_reads_installed_browser_cookie_profiles() -> anyhow::Result<()> {
    let temporary_directory = TempDir::new("browser-cookies")?;
    let host = ".example.com";
    let chrome_path = create_chromium_profile(temporary_directory.path(), host)?;
    let firefox_path = create_firefox_profile(temporary_directory.path())?;

    let profiles = list_browser_profiles(
        BrowserProfileOptions::default()
            .home_dir(temporary_directory.path())
            .platform("linux"),
    )?;
    assert_eq!(profiles.len(), 2);
    assert_eq!(profiles[0].browser, "chrome");
    assert_eq!(profiles[0].display_name, "Primary profile");
    assert_eq!(profiles[0].path, chrome_path);
    assert!(profiles[0].is_default);
    assert_eq!(profiles[1].browser, "firefox");
    assert_eq!(profiles[1].path, firefox_path);

    let cookies = read_browser_cookies(
        BrowserCookieReadOptions::new("chrome")
            .home_dir(temporary_directory.path())
            .platform("linux")
            .domain_filter("example.com")
            .cache(false),
    )?;
    assert_eq!(cookies.len(), 1);
    assert_eq!(cookies[0].name, "SID");
    assert_eq!(cookies[0].value, "decrypted-session");
    assert_eq!(cookies[0].domain, host);
    assert_eq!(cookies[0].path, "/");
    assert_eq!(cookies[0].expires, 2_000_000_000);
    assert!(cookies[0].http_only);
    assert!(cookies[0].secure);
    assert_eq!(cookies[0].same_site, "Strict");

    let firefox_cookies = read_browser_cookies(
        BrowserCookieReadOptions::new("firefox")
            .home_dir(temporary_directory.path())
            .platform("linux")
            .cache(false),
    )?;
    assert_eq!(firefox_cookies.len(), 1);
    assert_eq!(firefox_cookies[0].name, "firefox-session");
    assert_eq!(firefox_cookies[0].value, "plain-value");
    assert_eq!(firefox_cookies[0].same_site, "Lax");

    Ok(())
}

fn create_chromium_profile(home: &Path, host: &str) -> anyhow::Result<PathBuf> {
    let root = home.join(".config/google-chrome");
    let profile = root.join("Default");
    let cookie_path = profile.join("Network/Cookies");
    fs::create_dir_all(cookie_path.parent().unwrap())?;
    fs::write(
        root.join("Local State"),
        r#"{"profile":{"last_used":"Default","info_cache":{"Default":{"name":"Primary profile"}}}}"#,
    )?;

    let database = Connection::open(cookie_path)?;
    database.execute_batch(
        "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);\
         INSERT INTO meta (key, value) VALUES ('version', '24');\
         CREATE TABLE cookies (\
           host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT,\
           expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER\
         );",
    )?;
    database.execute(
        "INSERT INTO cookies VALUES (?, 'SID', '', ?, '/', ?, 1, 1, 2)",
        params![
            host,
            encrypt_linux_cookie(host, "decrypted-session"),
            (2_000_000_000_i64 + CHROME_EPOCH_OFFSET_SECONDS) * 1_000_000
        ],
    )?;
    Ok(profile)
}

fn encrypt_linux_cookie(host: &str, value: &str) -> Vec<u8> {
    let mut key = [0_u8; 16];
    pbkdf2_hmac::<Sha1>(b"peanuts", b"saltysalt", 1, &mut key);
    let mut plaintext = Sha256::digest(host.as_bytes()).to_vec();
    plaintext.extend_from_slice(value.as_bytes());
    let encrypted = Aes128CbcEncryptor::new(&key.into(), &[0x20; 16].into())
        .encrypt_padded_vec_mut::<Pkcs7>(&plaintext);
    [b"v10".as_slice(), encrypted.as_slice()].concat()
}

fn create_firefox_profile(home: &Path) -> anyhow::Result<PathBuf> {
    let root = home.join(".mozilla/firefox");
    let profile = root.join("fixture.default-release");
    fs::create_dir_all(&profile)?;
    fs::write(
        root.join("profiles.ini"),
        "[Profile0]\nName=default-release\nIsRelative=1\nPath=fixture.default-release\nDefault=1\n",
    )?;
    let database = Connection::open(profile.join("cookies.sqlite"))?;
    database.execute_batch(
        "CREATE TABLE moz_cookies (\
           name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,\
           isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER\
         );\
         INSERT INTO moz_cookies VALUES (\
           'firefox-session', 'plain-value', '.example.org', '/', 2000000001, 1, 0, 1\
         );",
    )?;
    Ok(profile)
}

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> std::io::Result<Self> {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!(
            "browser-commander-{label}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path)?;
        Ok(Self(path))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
