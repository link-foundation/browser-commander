//! Import cookies from installed Chrome-family and Firefox profiles.

use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::browser_cookie_cache::{
    get_cached_credential, normalize_cookie_cache, read_cookie_result_cache,
    write_cookie_result_cache, NormalizedCookieCache,
};
use super::browser_cookie_credentials::{
    decrypt_windows_dpapi, read_safe_storage_password, read_windows_encryption_key,
};
use super::browser_cookie_crypto::{
    chromium_same_site, decode_chromium_plaintext, decrypt_chromium_cookie,
    derive_chromium_cookie_key, firefox_same_site,
};
use super::browser_profiles::{
    find_cookie_database, normalize_cookie_browser, resolve_browser_profile, BrowserProfile,
    BrowserProfileOptions,
};

const CHROME_EPOCH_OFFSET_SECONDS: i64 = 11_644_473_600;

/// A browser cookie in the shape accepted by Playwright/Puppeteer contexts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCookie {
    /// Cookie name.
    pub name: String,
    /// Decrypted cookie value.
    pub value: String,
    /// Cookie domain, including any leading dot.
    pub domain: String,
    /// Cookie path.
    pub path: String,
    /// Unix expiry seconds, or `-1` for a session cookie.
    pub expires: i64,
    /// Whether JavaScript is prevented from reading the cookie.
    pub http_only: bool,
    /// Whether the cookie is restricted to secure transports.
    pub secure: bool,
    /// `Strict`, `Lax`, or `None`.
    pub same_site: String,
}

/// Options for [`read_browser_cookies`].
#[derive(Debug, Clone)]
pub struct BrowserCookieReadOptions {
    /// Installed browser name.
    pub browser: String,
    /// Optional on-disk or display profile name.
    pub profile: Option<String>,
    /// Optional domain substring used by the SQLite query.
    pub domain_filter: Option<String>,
    /// Enable the owner-only decrypted-result and derived-key cache.
    pub cache: bool,
    /// Override the cache directory.
    pub cache_dir: Option<PathBuf>,
    /// Cache lifetime in minutes.
    pub ttl_minutes: Option<f64>,
    /// Bypass cached values and coordinate one refreshed credential read.
    pub refresh: bool,
    /// Skip individual cookies that cannot be decrypted.
    pub ignore_decryption_errors: bool,
    /// Home directory used for profile discovery and the default cache.
    pub home_dir: PathBuf,
    /// Platform convention (`linux`, `darwin`, or `win32`).
    pub platform: String,
}

impl BrowserCookieReadOptions {
    /// Create options for one installed browser.
    pub fn new(browser: impl Into<String>) -> Self {
        Self {
            browser: browser.into(),
            profile: None,
            domain_filter: None,
            cache: true,
            cache_dir: None,
            ttl_minutes: None,
            refresh: false,
            ignore_decryption_errors: false,
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            platform: super::browser_profiles::current_platform().to_string(),
        }
    }

    /// Select a named installed-browser profile.
    pub fn profile(mut self, profile: impl Into<String>) -> Self {
        self.profile = Some(profile.into());
        self
    }

    /// Restrict the SQLite query to domains containing this value.
    pub fn domain_filter(mut self, domain: impl Into<String>) -> Self {
        self.domain_filter = Some(domain.into());
        self
    }

    /// Enable or disable disk caching.
    pub fn cache(mut self, enabled: bool) -> Self {
        self.cache = enabled;
        self
    }

    /// Override the owner-only cache directory.
    pub fn cache_dir(mut self, directory: impl Into<PathBuf>) -> Self {
        self.cache_dir = Some(directory.into());
        self
    }

    /// Set the decrypted-result and derived-key cache TTL.
    pub fn ttl_minutes(mut self, minutes: f64) -> Self {
        self.ttl_minutes = Some(minutes);
        self
    }

    /// Force a coordinated refresh of cached results and credentials.
    pub fn refresh(mut self, refresh: bool) -> Self {
        self.refresh = refresh;
        self
    }

    /// Skip cookies whose platform decryption fails.
    pub fn ignore_decryption_errors(mut self, ignore: bool) -> Self {
        self.ignore_decryption_errors = ignore;
        self
    }

    /// Override the home directory used for discovery.
    pub fn home_dir(mut self, home_dir: impl Into<PathBuf>) -> Self {
        self.home_dir = home_dir.into();
        self
    }

    /// Override the platform convention, primarily for portable tooling/tests.
    pub fn platform(mut self, platform: impl AsRef<str>) -> Self {
        self.platform = super::browser_profiles::normalize_platform(platform.as_ref()).to_string();
        self
    }
}

#[derive(Debug)]
struct ChromiumRow {
    host: String,
    name: String,
    value: String,
    encrypted_value: Vec<u8>,
    path: String,
    expires: i64,
    secure: bool,
    http_only: bool,
    same_site: i64,
}

#[derive(Default)]
struct OperationKeyCache {
    attempts: HashMap<String, std::result::Result<Vec<u8>, String>>,
}

struct CookieDecryptionState<'a> {
    cache: &'a NormalizedCookieCache,
    operation_keys: OperationKeyCache,
}

impl OperationKeyCache {
    fn get_or_try_create<F>(&mut self, identity: &str, create: F) -> Result<Vec<u8>>
    where
        F: FnOnce() -> Result<Vec<u8>>,
    {
        if !self.attempts.contains_key(identity) {
            self.attempts.insert(
                identity.to_string(),
                create().map_err(|error| error.to_string()),
            );
        }
        self.attempts[identity]
            .clone()
            .map_err(|error| anyhow!(error))
    }
}

fn open_cookie_database(path: &std::path::Path) -> Result<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("Could not open browser cookie database: {}", path.display()))
}

fn read_database_version(database: &Connection) -> i64 {
    database
        .query_row("SELECT value FROM meta WHERE key = 'version'", [], |row| {
            row.get::<_, String>(0)
        })
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_default()
}

fn domain_pattern(domain_filter: Option<&str>) -> Option<String> {
    domain_filter.map(|domain| format!("%{domain}%"))
}

fn read_chromium_rows(
    database: &Connection,
    domain_filter: Option<&str>,
) -> Result<Vec<ChromiumRow>> {
    let where_clause = domain_filter
        .map(|_| " WHERE host_key LIKE ?1")
        .unwrap_or("");
    let query = format!(
        "SELECT host_key, name, value, encrypted_value, path, expires_utc, \
         is_secure, is_httponly, samesite FROM cookies{where_clause} \
         ORDER BY host_key, name, path"
    );
    let mut statement = database.prepare(&query)?;
    let pattern = domain_pattern(domain_filter);
    let mapper = |row: &rusqlite::Row<'_>| {
        Ok(ChromiumRow {
            host: row.get(0)?,
            name: row.get(1)?,
            value: row.get(2)?,
            encrypted_value: row.get(3)?,
            path: row.get(4)?,
            expires: row.get(5)?,
            secure: row.get::<_, i64>(6)? != 0,
            http_only: row.get::<_, i64>(7)? != 0,
            same_site: row.get(8)?,
        })
    };
    let rows = if let Some(pattern) = pattern.as_deref() {
        statement.query_map(params![pattern], mapper)?
    } else {
        statement.query_map([], mapper)?
    };
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn read_firefox_cookies(
    database: &Connection,
    domain_filter: Option<&str>,
) -> Result<Vec<BrowserCookie>> {
    let where_clause = domain_filter.map(|_| " WHERE host LIKE ?1").unwrap_or("");
    let query = format!(
        "SELECT name, value, host, path, expiry, isSecure, isHttpOnly, sameSite \
         FROM moz_cookies{where_clause} ORDER BY host, name, path"
    );
    let mut statement = database.prepare(&query)?;
    let pattern = domain_pattern(domain_filter);
    let mapper = |row: &rusqlite::Row<'_>| {
        let expires = row.get::<_, i64>(4)?;
        Ok(BrowserCookie {
            name: row.get(0)?,
            value: row.get(1)?,
            domain: row.get(2)?,
            path: row.get::<_, String>(3).map(|path| {
                if path.is_empty() {
                    "/".to_string()
                } else {
                    path
                }
            })?,
            expires: if expires > 0 { expires } else { -1 },
            secure: row.get::<_, i64>(5)? != 0,
            http_only: row.get::<_, i64>(6)? != 0,
            same_site: firefox_same_site(row.get(7)?).to_string(),
        })
    };
    let rows = if let Some(pattern) = pattern.as_deref() {
        statement.query_map(params![pattern], mapper)?
    } else {
        statement.query_map([], mapper)?
    };
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn credential_metadata(browser: &str, platform: &str, source: &str) -> Map<String, Value> {
    let mut metadata = Map::new();
    metadata.insert("browser".into(), json!(browser));
    metadata.insert("platform".into(), json!(platform));
    metadata.insert("source".into(), json!(source));
    metadata
}

fn chromium_key_for_prefix(
    prefix: &[u8],
    browser: &str,
    platform: &str,
    profile: &BrowserProfile,
    refresh: bool,
    state: &mut CookieDecryptionState<'_>,
) -> Result<Vec<u8>> {
    if platform == "linux" && prefix == b"v10" {
        return derive_chromium_cookie_key("peanuts", "linux");
    }
    if platform == "linux" || platform == "darwin" {
        let identity = format!("{browser}:{platform}:safe-storage");
        return state.operation_keys.get_or_try_create(&identity, || {
            get_cached_credential(
                state.cache,
                &identity,
                refresh,
                credential_metadata(browser, platform, "safe-storage"),
                || {
                    derive_chromium_cookie_key(
                        &read_safe_storage_password(browser, platform)?,
                        platform,
                    )
                },
            )
        });
    }
    if platform == "win32" {
        let identity = format!("{browser}:win32:legacy-aes-key");
        return state.operation_keys.get_or_try_create(&identity, || {
            get_cached_credential(
                state.cache,
                &identity,
                refresh,
                credential_metadata(browser, platform, "dpapi"),
                || {
                    read_windows_encryption_key(
                        &profile
                            .path
                            .parent()
                            .unwrap_or(&profile.path)
                            .join("Local State"),
                    )
                },
            )
        });
    }
    Err(anyhow!(
        "Chromium cookie decryption is unsupported on {platform}"
    ))
}

fn chromium_expires(value: i64) -> i64 {
    if value == 0 {
        -1
    } else {
        value / 1_000_000 - CHROME_EPOCH_OFFSET_SECONDS
    }
}

fn decrypt_chromium_row(
    row: ChromiumRow,
    database_version: i64,
    browser: &str,
    platform: &str,
    profile: &BrowserProfile,
    refresh: bool,
    state: &mut CookieDecryptionState<'_>,
) -> Result<BrowserCookie> {
    let value = if !row.value.is_empty() {
        row.value
    } else if row.encrypted_value.is_empty() {
        String::new()
    } else {
        let prefix = row.encrypted_value.get(..3).unwrap_or_default();
        if platform == "win32" && prefix != b"v10" && prefix != b"v11" {
            if prefix == b"v20" {
                decrypt_chromium_cookie(
                    &row.encrypted_value,
                    &row.host,
                    database_version,
                    platform,
                    &[0_u8; 32],
                )?
            } else {
                decode_chromium_plaintext(
                    &decrypt_windows_dpapi(&row.encrypted_value)?,
                    &row.host,
                    database_version,
                )?
            }
        } else {
            let key = chromium_key_for_prefix(prefix, browser, platform, profile, refresh, state)?;
            decrypt_chromium_cookie(
                &row.encrypted_value,
                &row.host,
                database_version,
                platform,
                &key,
            )?
        }
    };
    Ok(BrowserCookie {
        name: row.name,
        value,
        domain: row.host,
        path: if row.path.is_empty() {
            "/".into()
        } else {
            row.path
        },
        expires: chromium_expires(row.expires),
        http_only: row.http_only,
        secure: row.secure,
        same_site: chromium_same_site(row.same_site).to_string(),
    })
}

fn read_chromium_cookies(
    database: &Connection,
    profile: &BrowserProfile,
    options: &BrowserCookieReadOptions,
    cache: &NormalizedCookieCache,
) -> Result<Vec<BrowserCookie>> {
    let version = read_database_version(database);
    let mut cookies = Vec::new();
    let mut state = CookieDecryptionState {
        cache,
        operation_keys: OperationKeyCache::default(),
    };
    for row in read_chromium_rows(database, options.domain_filter.as_deref())? {
        let name = row.name.clone();
        let host = row.host.clone();
        match decrypt_chromium_row(
            row,
            version,
            &options.browser,
            &options.platform,
            profile,
            options.refresh,
            &mut state,
        ) {
            Ok(cookie) => cookies.push(cookie),
            Err(_) if options.ignore_decryption_errors => {}
            Err(error) => {
                return Err(anyhow!(
                    "Could not decrypt cookie {name} for {host}: {error}"
                ))
            }
        }
    }
    Ok(cookies)
}

/// Read cookies from an installed Chrome, Edge, Brave, Chromium, or Firefox profile.
pub fn read_browser_cookies(mut options: BrowserCookieReadOptions) -> Result<Vec<BrowserCookie>> {
    options.browser = normalize_cookie_browser(&options.browser)?.to_string();
    let discovery = BrowserProfileOptions::default()
        .browser(&options.browser)
        .home_dir(&options.home_dir)
        .platform(&options.platform);
    let profile =
        resolve_browser_profile(&options.browser, options.profile.as_deref(), &discovery)?;
    let cookie_path = find_cookie_database(&options.browser, &profile.path)
        .ok_or_else(|| anyhow!("No cookie database exists in {}", profile.path.display()))?;
    let cache = normalize_cookie_cache(
        options.cache,
        options.cache_dir.as_deref(),
        &options.home_dir,
        options.ttl_minutes,
    )?;
    let identity = serde_json::to_string(&json!({
        "browser": options.browser,
        "profile": profile.path,
        "domainFilter": options.domain_filter,
    }))?;
    if let Some(values) = read_cookie_result_cache(&cache, &identity, options.refresh) {
        return values
            .into_iter()
            .map(serde_json::from_value)
            .collect::<serde_json::Result<Vec<_>>>()
            .context("cached cookies have an invalid shape");
    }

    let database = open_cookie_database(&cookie_path)?;
    let cookies = if options.browser == "firefox" {
        read_firefox_cookies(&database, options.domain_filter.as_deref())?
    } else {
        read_chromium_cookies(&database, &profile, &options, &cache)?
    };
    let serialized = cookies
        .iter()
        .map(serde_json::to_value)
        .collect::<serde_json::Result<Vec<_>>>()?;
    write_cookie_result_cache(&cache, &identity, &serialized)?;
    Ok(cookies)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_key_cache_reads_a_refreshed_credential_once() -> Result<()> {
        let mut keys = OperationKeyCache::default();
        let mut calls = 0;
        assert_eq!(
            keys.get_or_try_create("safe-storage", || {
                calls += 1;
                Ok(vec![7_u8; 16])
            })?,
            vec![7_u8; 16]
        );
        assert_eq!(
            keys.get_or_try_create("safe-storage", || {
                calls += 1;
                Ok(vec![8_u8; 16])
            })?,
            vec![7_u8; 16]
        );
        assert_eq!(calls, 1);
        Ok(())
    }
}
