//! Import cookies from installed Chrome-family and Firefox profiles.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use super::browser_sources::{browser_family, Environment};
use super::default_browser::{default_run_command, resolve_default_browser, RunCommand};

use super::browser_cookie_cache::{
    get_cached_credential, normalize_cookie_cache, read_cookie_result_cache,
    write_cookie_result_cache, NormalizedCookieCache,
};
use super::browser_cookie_credentials::{
    decrypt_windows_dpapi, read_safe_storage_password, read_windows_encryption_key,
};
use super::browser_cookie_crypto::{
    app_bound_cookie_error, chromium_same_site, decode_chromium_plaintext, decrypt_chromium_cookie,
    derive_chromium_cookie_key, firefox_same_site,
};
use super::browser_profiles::{
    find_cookie_database, is_default_browser_keyword, list_browser_profiles, normalize_platform,
    resolve_browser_profile, resolve_source_browser, BrowserProfileOptions,
};
use super::migration::MigrationEntry;

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
#[derive(Clone)]
pub struct BrowserCookieReadOptions {
    /// Installed browser name, or `default`/`auto` for the system default.
    pub browser: String,
    /// Optional on-disk or display profile name.
    pub profile: Option<String>,
    /// Explicit profile directory. When set, the reader uses it directly
    /// instead of resolving the default profile location (for example a
    /// migration honouring a custom `userDataDir`).
    pub profile_dir: Option<PathBuf>,
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
    /// Environment used to expand profile-root templates (`%APPDATA%`, ...).
    pub environment: Environment,
    /// Command runner used to resolve the system default browser, injectable
    /// for deterministic tests. `None` uses a real subprocess.
    pub run_command: Option<RunCommand>,
}

impl std::fmt::Debug for BrowserCookieReadOptions {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BrowserCookieReadOptions")
            .field("browser", &self.browser)
            .field("profile", &self.profile)
            .field("profile_dir", &self.profile_dir)
            .field("domain_filter", &self.domain_filter)
            .field("cache", &self.cache)
            .field("cache_dir", &self.cache_dir)
            .field("ttl_minutes", &self.ttl_minutes)
            .field("refresh", &self.refresh)
            .field("ignore_decryption_errors", &self.ignore_decryption_errors)
            .field("home_dir", &self.home_dir)
            .field("platform", &self.platform)
            .field("environment", &self.environment)
            .field("run_command", &self.run_command.as_ref().map(|_| "<fn>"))
            .finish()
    }
}

impl BrowserCookieReadOptions {
    /// Create options for one installed browser.
    pub fn new(browser: impl Into<String>) -> Self {
        Self {
            browser: browser.into(),
            profile: None,
            profile_dir: None,
            domain_filter: None,
            cache: true,
            cache_dir: None,
            ttl_minutes: None,
            refresh: false,
            ignore_decryption_errors: false,
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            platform: super::browser_profiles::current_platform().to_string(),
            environment: super::browser_sources::current_environment(),
            run_command: None,
        }
    }

    /// Select a named installed-browser profile.
    pub fn profile(mut self, profile: impl Into<String>) -> Self {
        self.profile = Some(profile.into());
        self
    }

    /// Read from an explicit profile directory instead of resolving the
    /// default profile location for the browser.
    pub fn profile_dir(mut self, profile_dir: impl Into<PathBuf>) -> Self {
        self.profile_dir = Some(profile_dir.into());
        self
    }

    /// Override the environment used when expanding profile-root templates.
    pub fn environment(mut self, environment: Environment) -> Self {
        self.environment = environment;
        self
    }

    /// Inject the command runner used to resolve the system default browser.
    pub fn run_command(mut self, run_command: RunCommand) -> Self {
        self.run_command = Some(run_command);
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

pub(crate) fn read_firefox_cookies(
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
    profile_path: &Path,
    refresh: bool,
    state: &mut CookieDecryptionState<'_>,
) -> Result<Vec<u8>> {
    if platform == "linux" && prefix == b"v10" {
        // Chromium's legacy Linux v10 format uses this public fallback secret;
        // a different value would make existing source cookies unreadable.
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
                        &profile_path
                            .parent()
                            .unwrap_or(profile_path)
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
    profile_path: &Path,
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
                return Err(app_bound_cookie_error());
            }
            decode_chromium_plaintext(
                &decrypt_windows_dpapi(&row.encrypted_value)?,
                &row.host,
                database_version,
            )?
        } else {
            let key =
                chromium_key_for_prefix(prefix, browser, platform, profile_path, refresh, state)?;
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
    profile_path: &Path,
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
            profile_path,
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
    let browser = resolve_source_browser(
        &options.browser,
        &options.platform,
        &options.environment,
        options.run_command.as_ref(),
    )?;
    options.browser = browser.to_string();
    // A caller that already resolved the profile directory (for example a
    // migration honouring a custom `userDataDir`) passes it as `profile_dir`,
    // so the reader does not re-resolve the default profile location.
    let profile_path = match &options.profile_dir {
        Some(directory) => directory.clone(),
        None => {
            let mut discovery = BrowserProfileOptions::default()
                .browser(browser)
                .home_dir(&options.home_dir)
                .platform(&options.platform)
                .environment(options.environment.clone());
            if let Some(run_command) = options.run_command.clone() {
                discovery = discovery.run_command(run_command);
            }
            resolve_browser_profile(browser, options.profile.as_deref(), &discovery)?.path
        }
    };
    let cookie_path = find_cookie_database(browser, &profile_path)
        .ok_or_else(|| anyhow!("No cookie database exists in {}", profile_path.display()))?;
    let cache = normalize_cookie_cache(
        options.cache,
        options.cache_dir.as_deref(),
        &options.home_dir,
        options.ttl_minutes,
    )?;
    let identity = serde_json::to_string(&json!({
        "browser": options.browser,
        "profile": profile_path,
        "domainFilter": options.domain_filter,
        "ignoreDecryptionErrors": options.ignore_decryption_errors,
    }))?;
    if let Some(values) = read_cookie_result_cache(&cache, &identity, options.refresh) {
        return values
            .into_iter()
            .map(serde_json::from_value)
            .collect::<serde_json::Result<Vec<_>>>()
            .context("cached cookies have an invalid shape");
    }

    let database = open_cookie_database(&cookie_path)?;
    let cookies = if browser_family(browser)? == "firefox" {
        read_firefox_cookies(&database, options.domain_filter.as_deref())?
    } else {
        read_chromium_cookies(&database, &profile_path, &options, &cache)?
    };
    let serialized = cookies
        .iter()
        .map(serde_json::to_value)
        .collect::<serde_json::Result<Vec<_>>>()?;
    write_cookie_result_cache(&cache, &identity, &serialized)?;
    Ok(cookies)
}

/// One installed browser profile that holds cookies, with per-domain counts
/// when a domain filter is supplied. Cookie values are never read, so this is
/// the data behind the `cookies sources` command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieSourceListing {
    /// Normalized browser name.
    pub browser: String,
    /// On-disk profile name.
    pub profile: String,
    /// Profile directory holding the cookie database.
    pub path: PathBuf,
    /// Whether the browser marks this profile as the default one.
    pub is_default: bool,
    /// Total cookie count, absent when the database could not be read.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cookies: Option<u64>,
    /// Per-domain counts, present only when a domain filter was supplied.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub by_domain: Option<BTreeMap<String, u64>>,
    /// Message describing why this profile's cookies could not be counted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Count cookies in a database by domain, without ever reading a cookie value.
/// Only host names and row counts are touched, so this is safe to expose for a
/// "which browser holds cookies for this domain" listing.
fn count_cookies_by_domain(
    database: &Connection,
    family: &str,
    domains: &[String],
) -> Result<(u64, Option<BTreeMap<String, u64>>)> {
    let column = if family == "firefox" {
        "host"
    } else {
        "host_key"
    };
    let table = if family == "firefox" {
        "moz_cookies"
    } else {
        "cookies"
    };
    let count_for = |filter: Option<&str>| -> Result<u64> {
        let count = match filter {
            Some(domain) => {
                let query = format!("SELECT COUNT(*) FROM {table} WHERE {column} LIKE ?1");
                database.query_row(&query, params![format!("%{domain}%")], |row| {
                    row.get::<_, i64>(0)
                })?
            }
            None => {
                let query = format!("SELECT COUNT(*) FROM {table}");
                database.query_row(&query, [], |row| row.get::<_, i64>(0))?
            }
        };
        Ok(count.max(0) as u64)
    };
    let total = count_for(None)?;
    if domains.is_empty() {
        return Ok((total, None));
    }
    let mut by_domain = BTreeMap::new();
    for domain in domains {
        by_domain.insert(domain.clone(), count_for(Some(domain))?);
    }
    Ok((total, Some(by_domain)))
}

/// List the installed browser profiles that hold cookies, with per-domain
/// counts when `domains` is given. Values are never read or returned — this is
/// the data behind the `cookies sources` command.
pub fn list_cookie_sources(
    domains: &[String],
    platform: &str,
    home_dir: &Path,
    environment: &Environment,
) -> Result<Vec<CookieSourceListing>> {
    let profiles = list_browser_profiles(
        BrowserProfileOptions::default()
            .home_dir(home_dir)
            .platform(platform)
            .environment(environment.clone()),
    )?;
    let mut sources = Vec::new();
    for profile in profiles {
        let Some(cookie_path) = find_cookie_database(&profile.browser, &profile.path) else {
            continue;
        };
        let family = browser_family(&profile.browser)?;
        match open_cookie_database(&cookie_path)
            .and_then(|database| count_cookies_by_domain(&database, family, domains))
        {
            Ok((total, by_domain)) => {
                // When filtering by domain, skip profiles that hold none.
                let matched = by_domain
                    .as_ref()
                    .map(|counts| counts.values().sum::<u64>())
                    .unwrap_or(total);
                if !domains.is_empty() && matched == 0 {
                    continue;
                }
                sources.push(CookieSourceListing {
                    browser: profile.browser,
                    profile: profile.name,
                    path: profile.path,
                    is_default: profile.is_default,
                    cookies: Some(total),
                    by_domain,
                    error: None,
                });
            }
            Err(error) => sources.push(CookieSourceListing {
                browser: profile.browser,
                profile: profile.name,
                path: profile.path,
                is_default: profile.is_default,
                cookies: None,
                by_domain: None,
                error: Some(error.to_string()),
            }),
        }
    }
    Ok(sources)
}

/// The browser an import reads from, as chosen by [`resolve_import_source`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportSource {
    /// Canonical catalogue id of the source browser.
    pub browser: String,
    /// The profile holding the requested cookies, when one was chosen.
    pub profile: Option<String>,
    /// A migration-report warning explaining a fallback away from the system
    /// default browser.
    pub warning: Option<MigrationEntry>,
}

fn matched_cookies(source: &CookieSourceListing) -> u64 {
    source
        .by_domain
        .as_ref()
        .map(|counts| counts.values().sum())
        .unwrap_or(0)
}

/// Pick the source browser for an import.
///
/// A `default`/`auto` request scoped to `domains` uses the system default
/// browser when it holds cookies for them and otherwise falls back to the
/// installed browser profile holding the most, so "import my github.com
/// sign-in" works whichever browser has it. Only names and counts are read
/// (see [`list_cookie_sources`]), never cookie values.
pub fn resolve_import_source(
    browser: &str,
    domains: &[String],
    platform: &str,
    home_dir: &Path,
    environment: &Environment,
    run_command: Option<&RunCommand>,
) -> Result<ImportSource> {
    if !is_default_browser_keyword(browser) || domains.is_empty() {
        return Ok(ImportSource {
            browser: resolve_source_browser(browser, platform, environment, run_command)?
                .to_string(),
            profile: None,
            warning: None,
        });
    }
    let platform = normalize_platform(platform);
    let fallback;
    let runner = match run_command {
        Some(runner) => runner,
        None => {
            fallback = default_run_command();
            &fallback
        }
    };
    let system_default = resolve_default_browser(platform, environment, runner)?;
    let holders: Vec<CookieSourceListing> =
        list_cookie_sources(domains, platform, home_dir, environment)?
            .into_iter()
            .filter(|source| source.error.is_none())
            .collect();
    let from_default: Vec<&CookieSourceListing> = holders
        .iter()
        .filter(|source| Some(source.browser.as_str()) == system_default)
        .collect();
    let candidates = if from_default.is_empty() {
        holders.iter().collect()
    } else {
        from_default
    };
    let listed = domains.join(", ");
    // The first profile with the most matching cookies; listing order breaks
    // ties, so a browser's default profile wins over its others.
    let Some(best) = candidates.iter().copied().reduce(|best, source| {
        if matched_cookies(source) > matched_cookies(best) {
            source
        } else {
            best
        }
    }) else {
        let browser = system_default.ok_or_else(|| {
            anyhow!(
                "Could not determine the system default browser, and no installed browser holds cookies for {listed}."
            )
        })?;
        return Ok(ImportSource {
            browser: browser.to_string(),
            profile: None,
            warning: None,
        });
    };
    let warning = (Some(best.browser.as_str()) != system_default).then(|| {
        let (reason, detail) = match system_default {
            Some(default) => (
                "default-browser-fallback",
                format!("The default browser ({default}) holds no cookies for"),
            ),
            None => (
                "default-browser-unknown",
                "Could not determine the default browser to read cookies for".to_string(),
            ),
        };
        MigrationEntry::new("source", best.browser.clone(), reason).with_detail(format!(
            "{detail} {listed}; imported from {} instead.",
            best.browser
        ))
    });
    Ok(ImportSource {
        browser: best.browser.clone(),
        profile: Some(best.profile.clone()),
        warning,
    })
}

#[cfg(test)]
mod tests {
    // feature-parity: sources.cookie-listing@native-typed
    use super::*;
    use std::fs;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(prefix: &str) -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default();
            let count = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("{prefix}{}-{nanos:x}-{count}", std::process::id()));
            fs::create_dir_all(&path).expect("temporary directory");
            Self(path)
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

    struct FirefoxCookie {
        name: &'static str,
        value: &'static str,
        host: &'static str,
    }

    fn write_firefox_cookies(profile_dir: &Path, cookies: &[FirefoxCookie]) {
        fs::create_dir_all(profile_dir).expect("profile dir");
        let database = Connection::open(profile_dir.join("cookies.sqlite")).expect("open");
        database
            .execute_batch(
                "CREATE TABLE moz_cookies (\
                   name TEXT, value TEXT, host TEXT, path TEXT, expiry INTEGER,\
                   isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER\
                 );",
            )
            .expect("schema");
        for cookie in cookies {
            database
                .execute(
                    "INSERT INTO moz_cookies \
                     (name, value, host, path, expiry, isSecure, isHttpOnly, sameSite) \
                     VALUES (?1, ?2, ?3, '/', 0, 0, 0, 0)",
                    params![cookie.name, cookie.value, cookie.host],
                )
                .expect("insert");
        }
    }

    fn make_firefox_profile(home: &Path, cookies: &[FirefoxCookie]) -> PathBuf {
        make_firefox_profile_in(home, ".mozilla/firefox", "default-release", cookies)
    }

    /// A Firefox-family install under `home` at `root` with one default profile.
    fn make_firefox_profile_in(
        home: &Path,
        root: &str,
        name: &str,
        cookies: &[FirefoxCookie],
    ) -> PathBuf {
        let root = home.join(root);
        let profile_name = format!("xyz.{name}");
        let profile_path = root.join(&profile_name);
        fs::create_dir_all(&profile_path).expect("profile");
        fs::write(
            root.join("profiles.ini"),
            format!("[Profile0]\nName={name}\nIsRelative=1\nPath={profile_name}\nDefault=1\n"),
        )
        .expect("profiles.ini");
        write_firefox_cookies(&profile_path, cookies);
        profile_path
    }

    #[test]
    fn reports_cookie_counts_per_profile_without_reading_values() {
        let temp = TempDir::new("bc-src-");
        let profile_path = make_firefox_profile(
            temp.path(),
            &[
                FirefoxCookie {
                    name: "a",
                    value: "secret-1",
                    host: ".example.com",
                },
                FirefoxCookie {
                    name: "b",
                    value: "secret-2",
                    host: ".example.com",
                },
                FirefoxCookie {
                    name: "c",
                    value: "secret-3",
                    host: ".other.test",
                },
            ],
        );

        let sources = list_cookie_sources(&[], "linux", temp.path(), &Environment::new()).unwrap();
        assert_eq!(sources.len(), 1);
        let source = &sources[0];
        assert_eq!(source.browser, "firefox");
        assert_eq!(source.path, profile_path);
        assert_eq!(source.cookies, Some(3));
        assert_eq!(source.by_domain, None);
        // Never expose a value anywhere in the payload.
        let payload = serde_json::to_string(&sources).unwrap();
        assert!(!payload.contains("secret-"), "{payload}");
    }

    #[test]
    fn counts_per_domain_and_omits_profiles_that_hold_none() {
        let temp = TempDir::new("bc-src2-");
        make_firefox_profile(
            temp.path(),
            &[
                FirefoxCookie {
                    name: "a",
                    value: "1",
                    host: ".example.com",
                },
                FirefoxCookie {
                    name: "b",
                    value: "2",
                    host: ".example.com",
                },
            ],
        );

        let matched = list_cookie_sources(
            &["example.com".to_string()],
            "linux",
            temp.path(),
            &Environment::new(),
        )
        .unwrap();
        assert_eq!(matched.len(), 1);
        assert_eq!(
            matched[0].by_domain,
            Some(BTreeMap::from([("example.com".to_string(), 2)]))
        );

        let none = list_cookie_sources(
            &["absent.test".to_string()],
            "linux",
            temp.path(),
            &Environment::new(),
        )
        .unwrap();
        assert!(none.is_empty());
    }

    #[test]
    fn honours_an_explicit_profile_dir_over_the_default_profile_root() {
        let temp = TempDir::new("bc-profiledir-");
        // A custom userDataDir that is NOT under the default profile root.
        let custom_profile = temp.path().join("custom").join("profile");
        write_firefox_cookies(
            &custom_profile,
            &[FirefoxCookie {
                name: "sid",
                value: "abc",
                host: ".example.com",
            }],
        );
        // An empty home ensures a reader that ignored profile_dir finds nothing.
        let empty_home = temp.path().join("empty-home");
        fs::create_dir_all(&empty_home).expect("empty home");

        let cookies = read_browser_cookies(
            BrowserCookieReadOptions::new("firefox")
                .profile_dir(&custom_profile)
                .platform("linux")
                .home_dir(&empty_home)
                .cache(false),
        )
        .unwrap();
        assert_eq!(cookies.len(), 1);
        assert_eq!(cookies[0].name, "sid");
        assert_eq!(cookies[0].domain, ".example.com");
    }

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

    const GITHUB_COOKIE: [FirefoxCookie; 1] = [FirefoxCookie {
        name: "a",
        value: "1",
        host: ".github.com",
    }];
    const OTHER_COOKIE: [FirefoxCookie; 1] = [FirefoxCookie {
        name: "b",
        value: "2",
        host: ".other.test",
    }];

    fn firefox_is_default() -> RunCommand {
        std::sync::Arc::new(|_: &str, _: &[&str], _: &Environment| Ok("firefox.desktop\n".into()))
    }

    fn no_default() -> RunCommand {
        std::sync::Arc::new(|_: &str, _: &[&str], _: &Environment| Err(anyhow!("no xdg")))
    }

    fn resolve(
        browser: &str,
        domains: &[&str],
        home: &Path,
        runner: &RunCommand,
    ) -> Result<ImportSource> {
        let domains: Vec<String> = domains.iter().map(|domain| domain.to_string()).collect();
        resolve_import_source(
            browser,
            &domains,
            "linux",
            home,
            &Environment::new(),
            Some(runner),
        )
    }

    #[test]
    fn import_source_keeps_the_system_default_when_it_holds_the_domains() {
        // feature-parity: sources.default-domain-fallback@native-typed
        let temp = TempDir::new("bc-imp-");
        make_firefox_profile(temp.path(), &GITHUB_COOKIE);
        make_firefox_profile_in(temp.path(), ".librewolf", "default", &GITHUB_COOKIE);

        let source = resolve(
            "default",
            &["github.com"],
            temp.path(),
            &firefox_is_default(),
        )
        .unwrap();
        assert_eq!(
            source,
            ImportSource {
                browser: "firefox".into(),
                profile: Some("default-release".into()),
                warning: None,
            }
        );
    }

    #[test]
    fn import_source_falls_back_to_the_browser_that_holds_the_domains() {
        let temp = TempDir::new("bc-imp2-");
        make_firefox_profile(temp.path(), &OTHER_COOKIE);
        make_firefox_profile_in(temp.path(), ".librewolf", "default", &GITHUB_COOKIE);

        let source = resolve(
            "default",
            &["github.com"],
            temp.path(),
            &firefox_is_default(),
        )
        .unwrap();
        assert_eq!(source.browser, "librewolf");
        assert_eq!(source.profile.as_deref(), Some("default"));
        let warning = source.warning.expect("fallback warning");
        assert_eq!(warning.data_class, "source");
        assert_eq!(warning.item, "librewolf");
        assert_eq!(warning.reason, "default-browser-fallback");
        assert_eq!(
            warning.detail.as_deref(),
            Some("The default browser (firefox) holds no cookies for github.com; imported from librewolf instead.")
        );
    }

    #[test]
    fn import_source_falls_back_when_the_default_is_unknown() {
        let temp = TempDir::new("bc-imp3-");
        let home = temp.path().join("home");
        make_firefox_profile_in(&home, ".librewolf", "default", &GITHUB_COOKIE);

        let source = resolve("auto", &["github.com"], &home, &no_default()).unwrap();
        assert_eq!(source.browser, "librewolf");
        assert_eq!(
            source.warning.map(|warning| warning.reason).as_deref(),
            Some("default-browser-unknown")
        );
        let error = resolve(
            "default",
            &["github.com"],
            &temp.path().join("empty"),
            &no_default(),
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("no installed browser holds cookies"),
            "{error}"
        );
    }

    #[test]
    fn import_source_resolves_the_default_plainly_without_domains() {
        let temp = TempDir::new("bc-imp4-");
        let plain = |browser: &str, domains: &[&str]| {
            resolve(browser, domains, temp.path(), &firefox_is_default()).unwrap()
        };
        assert_eq!(
            plain("default", &[]),
            ImportSource {
                browser: "firefox".into(),
                profile: None,
                warning: None,
            }
        );
        assert_eq!(plain("Opera", &["github.com"]).browser, "opera");
    }
}
