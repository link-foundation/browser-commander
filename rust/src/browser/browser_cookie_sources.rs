//! Which installed browsers hold cookies, and which one an import reads from.
//!
//! Everything here touches only host names and row counts, never cookie
//! values, so it is safe to run before asking a person to import anything.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::browser_cookies::open_cookie_database;
use super::browser_profiles::{
    find_cookie_database, is_default_browser_keyword, list_browser_profiles, normalize_platform,
    resolve_source_browser, BrowserProfileOptions,
};
use super::browser_sources::{browser_family, Environment};
use super::default_browser::{default_run_command, resolve_default_browser, RunCommand};
use super::migration::MigrationEntry;

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
pub(crate) mod tests {
    // feature-parity: sources.cookie-listing@native-typed
    use super::*;
    use std::fs;

    pub(crate) struct TempDir(PathBuf);

    impl TempDir {
        pub(crate) fn new(prefix: &str) -> Self {
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

        pub(crate) fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    pub(crate) struct FirefoxCookie {
        pub name: &'static str,
        pub value: &'static str,
        pub host: &'static str,
    }

    pub(crate) fn write_firefox_cookies(profile_dir: &Path, cookies: &[FirefoxCookie]) {
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
