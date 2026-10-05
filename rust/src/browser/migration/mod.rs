//! Profile migration, mirroring `js/src/browser/migration/index.js`.
//!
//! Copies a person's data from a real browser profile into a dedicated target
//! profile, one data class at a time, and returns the report shape documented
//! in `docs/cli-and-bridge.md`. Nothing is ever written to the source profile,
//! and every database read goes through a consistent read-only snapshot, so the
//! migration is safe to run while the source browser is open.
//!
//! Cookies are returned (not written): a running Chromium re-derives its own
//! cookie encryption, so the launcher seeds them over CDP with the existing
//! `seed_cookies` path. Every other data class is written into the target
//! profile directory.

mod bookmarks;
mod chromium_crypto;
mod cookies;
mod extensions;
mod firefox;
mod firefox_bookmarks;
mod firefox_der;
mod firefox_nss;
mod fs_utils;
mod history;
mod os_crypt_keys;
mod passwords;
mod preferences;
pub(crate) mod sqlite_snapshot;

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use crate::browser::browser_cookie_sources::resolve_import_source;
use crate::browser::browser_cookies::BrowserCookie;
use crate::browser::browser_profiles::{
    browser_profile_root_in, current_platform, normalize_platform, resolve_browser_profile,
    BrowserProfileOptions,
};
use crate::browser::browser_sources::{
    browser_family, current_environment, is_single_profile_browser, Environment,
};
use crate::browser::default_browser::RunCommand;

pub use cookies::{CookieReader, DBSC_BOUND_COOKIE_NAMES};
pub use firefox_nss::PrimaryPasswordError;
pub use os_crypt_keys::{
    KeystoreHooks, SafeStoragePasswordReader, SourceKeyResolver, TargetKey, WindowsKeyReader,
};
pub use preferences::MIGRATED_PREFERENCE_PATHS;

/// Every data class a migration can copy, in the order they run.
pub const ALL_DATA_CLASSES: [&str; 6] = [
    "cookies",
    "bookmarks",
    "history",
    "passwords",
    "preferences",
    "extensions",
];

const TARGET_KEY_UNAVAILABLE_DETAIL: &str = "A target encryption key was not available (on Windows the launcher must generate one and write it into the target Local State); passwords were not migrated.";

/// One skipped item or warning in a migration report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MigrationEntry {
    /// Data class (`cookies`, `bookmarks`, ...).
    #[serde(rename = "type")]
    pub data_class: String,
    /// The file, host or cookie the entry is about.
    pub item: String,
    /// A stable machine-readable reason.
    pub reason: String,
    /// Human-readable detail, when there is any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl MigrationEntry {
    /// Build an entry without detail.
    pub fn new(
        data_class: impl Into<String>,
        item: impl Into<String>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            data_class: data_class.into(),
            item: item.into(),
            reason: reason.into(),
            detail: None,
        }
    }

    /// Attach human-readable detail.
    #[must_use]
    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }
}

/// What one data-class step migrated, skipped and warned about.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ClassOutcome {
    pub migrated: u64,
    pub skipped: Vec<MigrationEntry>,
    pub warnings: Vec<MigrationEntry>,
}

impl ClassOutcome {
    pub(crate) fn migrated(count: u64) -> Self {
        Self {
            migrated: count,
            ..Self::default()
        }
    }

    pub(crate) fn skipped(entry: MigrationEntry) -> Self {
        Self {
            skipped: vec![entry],
            ..Self::default()
        }
    }
}

/// Per-class migrated counts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MigratedCounts {
    pub cookies: u64,
    pub bookmarks: u64,
    pub history: u64,
    pub passwords: u64,
    pub preferences: u64,
    pub extensions: u64,
}

impl MigratedCounts {
    fn add(&mut self, data_class: &str, count: u64) {
        let slot = match data_class {
            "cookies" => &mut self.cookies,
            "bookmarks" => &mut self.bookmarks,
            "history" => &mut self.history,
            "passwords" => &mut self.passwords,
            "preferences" => &mut self.preferences,
            _ => &mut self.extensions,
        };
        *slot += count;
    }
}

/// The source a migration read from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReportSource {
    /// Normalized browser name.
    pub browser: String,
    /// Profile name (`Default` unless one was requested).
    pub profile: String,
    /// The explicit user data directory, or `null`.
    pub user_data_dir: Option<PathBuf>,
}

/// The full result of [`migrate_profile`], including the cookies to seed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MigrationReport {
    pub source: MigrationReportSource,
    /// Target profile directory.
    pub target: PathBuf,
    pub migrated: MigratedCounts,
    pub skipped: Vec<MigrationEntry>,
    pub warnings: Vec<MigrationEntry>,
    /// Cookies read from the source, to seed over CDP (not written to disk).
    pub cookies: Vec<BrowserCookie>,
}

/// A migration report without its cookies, as `launch_real_browser` returns
/// it (the cookies are seeded, never echoed back).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MigrationSummary {
    pub source: MigrationReportSource,
    pub target: PathBuf,
    pub migrated: MigratedCounts,
    pub skipped: Vec<MigrationEntry>,
    pub warnings: Vec<MigrationEntry>,
}

impl MigrationReport {
    /// Split the report into its cookies and the cookie-free summary.
    pub fn into_parts(self) -> (Vec<BrowserCookie>, MigrationSummary) {
        (
            self.cookies,
            MigrationSummary {
                source: self.source,
                target: self.target,
                migrated: self.migrated,
                skipped: self.skipped,
                warnings: self.warnings,
            },
        )
    }

    fn merge(&mut self, data_class: &str, outcome: ClassOutcome) {
        self.migrated.add(data_class, outcome.migrated);
        self.skipped.extend(outcome.skipped);
        self.warnings.extend(outcome.warnings);
    }
}

/// Where to migrate from (`from` in the JavaScript API).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationSource {
    /// Source browser (`chrome`, `edge`/`msedge`, `brave`, `chromium`, `firefox`).
    pub browser: String,
    /// Profile name; defaults to `Default`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    /// Explicit user data directory (for Firefox, the profile directory).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_data_dir: Option<PathBuf>,
}

impl MigrationSource {
    /// Migrate from `browser`'s default profile.
    pub fn new(browser: impl Into<String>) -> Self {
        Self {
            browser: browser.into(),
            ..Self::default()
        }
    }

    /// Select a named profile.
    #[must_use]
    pub fn profile(mut self, profile: impl Into<String>) -> Self {
        self.profile = Some(profile.into());
        self
    }

    /// Read from an explicit user data directory.
    #[must_use]
    pub fn user_data_dir(mut self, user_data_dir: impl Into<PathBuf>) -> Self {
        self.user_data_dir = Some(user_data_dir.into());
        self
    }
}

/// Injected password keys (`keys` in the JavaScript API).
#[derive(Clone, Default)]
pub struct MigrationKeys {
    /// Resolves the source key per encryption prefix (Chromium sources).
    pub resolve_source_key: Option<SourceKeyResolver>,
    /// The dedicated profile's encryption key.
    pub target_key: Option<Vec<u8>>,
    /// Version prefix to write (`v10`/`v11`).
    pub target_prefix: Option<String>,
    /// The Firefox primary password, when one is set.
    pub primary_password: Option<Vec<u8>>,
}

impl std::fmt::Debug for MigrationKeys {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MigrationKeys")
            .field("resolve_source_key", &self.resolve_source_key.is_some())
            .field(
                "target_key",
                &self.target_key.as_ref().map(|_| "<redacted>"),
            )
            .field("target_prefix", &self.target_prefix)
            .finish_non_exhaustive()
    }
}

/// Options for [`migrate_profile`].
#[derive(Clone)]
pub struct MigrateProfileOptions {
    pub from: MigrationSource,
    /// Target profile directory.
    pub to: PathBuf,
    /// Data classes to migrate; defaults to [`ALL_DATA_CLASSES`].
    pub include: Vec<String>,
    /// Cookie domain filter (empty means all).
    pub domains: Vec<String>,
    /// Platform convention (`linux`, `darwin`, `win32`).
    pub platform: String,
    /// The launching browser channel, used to derive the target key.
    pub target_browser: Option<String>,
    /// Injected password keys.
    pub keys: Option<MigrationKeys>,
    /// Home directory used to find conventional profile locations.
    pub home_dir: PathBuf,
    /// OS keystore readers (Safe Storage, Windows `Local State`).
    pub keystore: KeystoreHooks,
    /// Installed-browser cookie reader for Chromium sources.
    pub read_cookies: CookieReader,
    /// Environment used to expand profile-root templates.
    pub environment: Environment,
    /// Command runner for the default-browser lookup. With `from.browser`
    /// `default`/`auto` and `domains`, an import falls back from a default
    /// browser holding none of them to the installed profile holding the most,
    /// adding a `default-browser-fallback` warning.
    pub run_command: Option<RunCommand>,
}

impl std::fmt::Debug for MigrateProfileOptions {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("MigrateProfileOptions")
            .field("from", &self.from)
            .field("to", &self.to)
            .field("include", &self.include)
            .field("domains", &self.domains)
            .field("platform", &self.platform)
            .field("target_browser", &self.target_browser)
            .field("keys", &self.keys)
            .field("home_dir", &self.home_dir)
            .finish_non_exhaustive()
    }
}

impl MigrateProfileOptions {
    /// Migrate everything from `from` into the target profile directory `to`.
    pub fn new(from: MigrationSource, to: impl Into<PathBuf>) -> Self {
        Self {
            from,
            to: to.into(),
            include: ALL_DATA_CLASSES
                .iter()
                .map(|name| name.to_string())
                .collect(),
            domains: Vec::new(),
            platform: current_platform().to_string(),
            target_browser: None,
            keys: None,
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            keystore: KeystoreHooks::default(),
            read_cookies: cookies::default_cookie_reader(),
            environment: current_environment(),
            run_command: None,
        }
    }

    /// Restrict the migrated data classes.
    #[must_use]
    pub fn include<I, S>(mut self, include: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.include = include.into_iter().map(Into::into).collect();
        self
    }

    /// Restrict migrated cookies to hosts containing one of `domains`.
    #[must_use]
    pub fn domains<I, S>(mut self, domains: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.domains = domains.into_iter().map(Into::into).collect();
        self
    }

    /// Override the platform convention.
    #[must_use]
    pub fn platform(mut self, platform: impl AsRef<str>) -> Self {
        self.platform = normalize_platform(platform.as_ref()).to_string();
        self
    }

    /// Set the launching browser channel (target key derivation).
    #[must_use]
    pub fn target_browser(mut self, target_browser: impl Into<String>) -> Self {
        self.target_browser = Some(target_browser.into());
        self
    }

    /// Inject password keys.
    #[must_use]
    pub fn keys(mut self, keys: MigrationKeys) -> Self {
        self.keys = Some(keys);
        self
    }

    /// Override the home directory.
    #[must_use]
    pub fn home_dir(mut self, home_dir: impl Into<PathBuf>) -> Self {
        self.home_dir = home_dir.into();
        self
    }

    /// Override the OS keystore readers.
    #[must_use]
    pub fn keystore(mut self, keystore: KeystoreHooks) -> Self {
        self.keystore = keystore;
        self
    }

    /// Override the Chromium cookie reader.
    #[must_use]
    pub fn read_cookies(mut self, read_cookies: CookieReader) -> Self {
        self.read_cookies = read_cookies;
        self
    }

    /// Override the environment used to expand profile-root templates.
    #[must_use]
    pub fn environment(mut self, environment: Environment) -> Self {
        self.environment = environment;
        self
    }

    /// Inject the default-browser lookup's command runner.
    #[must_use]
    pub fn run_command(mut self, run_command: RunCommand) -> Self {
        self.run_command = Some(run_command);
        self
    }
}

fn is_chromium(browser: &str) -> bool {
    browser_family(browser)
        .map(|family| family == "chromium")
        .unwrap_or(false)
}

fn is_firefox_browser(browser: &str) -> bool {
    browser_family(browser)
        .map(|family| family == "firefox")
        .unwrap_or(false)
}

fn resolve_source_profile_dir(
    browser: &str,
    profile: &str,
    options: &MigrateProfileOptions,
) -> Result<PathBuf> {
    // A Chromium profile lives in a named subdirectory of the user data dir,
    // except in single-profile browsers (Opera) that keep it in the root; for
    // Firefox the user data directory already points at the profile.
    let nests_profiles = is_chromium(browser) && !is_single_profile_browser(browser)?;
    let in_root = |root: PathBuf| {
        if nests_profiles {
            root.join(profile)
        } else {
            root
        }
    };
    if let Some(user_data_dir) = &options.from.user_data_dir {
        return Ok(in_root(user_data_dir.clone()));
    }
    if is_chromium(browser) {
        return Ok(in_root(browser_profile_root_in(
            browser,
            &options.platform,
            &options.home_dir,
            &options.environment,
        )?));
    }
    let profile_options = BrowserProfileOptions::default()
        .home_dir(&options.home_dir)
        .platform(&options.platform)
        .environment(options.environment.clone());
    Ok(resolve_browser_profile(browser, Some(profile), &profile_options)?.path)
}

fn resolve_password_keys(
    options: &MigrateProfileOptions,
    browser: &str,
    target_browser: &str,
    source_profile_dir: &Path,
) -> Result<Option<MigrationKeys>> {
    if let Some(keys) = &options.keys {
        if keys.target_key.as_ref().is_some_and(|key| !key.is_empty()) {
            return Ok(Some(keys.clone()));
        }
    }
    let platform = options.platform.as_str();
    if platform != "darwin" && platform != "linux" {
        return Ok(None);
    }
    let TargetKey { key, prefix } =
        os_crypt_keys::resolve_target_key(target_browser, platform, &options.keystore)?;
    let resolve_source_key = is_chromium(browser).then(|| {
        os_crypt_keys::create_source_key_resolver(
            browser,
            platform,
            Some(os_crypt_keys::local_state_path_for_profile(
                source_profile_dir,
            )),
            options.keystore.clone(),
        )
    });
    Ok(Some(MigrationKeys {
        resolve_source_key,
        target_key: Some(key),
        target_prefix: Some(prefix),
        primary_password: None,
    }))
}

fn migrate_passwords_class(
    options: &MigrateProfileOptions,
    browser: &str,
    source_profile_dir: &Path,
    report: &mut MigrationReport,
) -> Result<()> {
    let is_firefox = is_firefox_browser(browser);
    let target_browser = options.target_browser.clone().unwrap_or_else(|| {
        if is_firefox {
            "chrome".into()
        } else {
            browser.into()
        }
    });
    let keys = resolve_password_keys(options, browser, &target_browser, source_profile_dir)?;
    let Some((keys, target_key)) = keys.and_then(|keys| {
        let target_key = keys.target_key.clone().filter(|key| !key.is_empty())?;
        Some((keys, target_key))
    }) else {
        report.skipped.push(MigrationEntry::new(
            "passwords",
            "Login Data",
            "target-key-unavailable",
        ));
        report.warnings.push(
            MigrationEntry::new("passwords", "Login Data", "target-key-unavailable")
                .with_detail(TARGET_KEY_UNAVAILABLE_DETAIL),
        );
        return Ok(());
    };
    let outcome = if is_firefox {
        firefox::migrate_firefox_passwords(
            source_profile_dir,
            &options.to,
            &firefox::FirefoxPasswordKeys {
                platform: &options.platform,
                target_key: &target_key,
                target_prefix: keys.target_prefix.as_deref(),
                primary_password: keys.primary_password.as_deref().unwrap_or_default(),
            },
        )?
    } else {
        let resolve_source_key = keys.resolve_source_key.clone().unwrap_or_else(|| {
            os_crypt_keys::create_source_key_resolver(
                browser,
                &options.platform,
                Some(os_crypt_keys::local_state_path_for_profile(
                    source_profile_dir,
                )),
                options.keystore.clone(),
            )
        });
        passwords::migrate_passwords(
            source_profile_dir,
            &options.to,
            &passwords::PasswordKeys {
                platform: &options.platform,
                resolve_source_key: &resolve_source_key,
                target_key: &target_key,
                target_prefix: keys.target_prefix.as_deref(),
            },
        )?
    };
    report.merge("passwords", outcome);
    Ok(())
}

/// Migrate a browser profile into a dedicated target profile directory.
///
/// Blocking: it reads SQLite snapshots and may query the OS keystore. From
/// async code, call it through `tokio::task::spawn_blocking`.
pub fn migrate_profile(options: MigrateProfileOptions) -> Result<MigrationReport> {
    if options.from.browser.is_empty() {
        return Err(anyhow!("migrate_profile requires from.browser"));
    }
    if options.to.as_os_str().is_empty() {
        return Err(anyhow!("migrate_profile requires a target directory (to)"));
    }
    // An explicit user data dir names the source, so only an installed-browser
    // import is steered towards the profile holding the requested domains.
    let no_domains: &[String] = &[];
    let source = resolve_import_source(
        &options.from.browser,
        if options.from.user_data_dir.is_some() {
            no_domains
        } else {
            &options.domains
        },
        &options.platform,
        &options.home_dir,
        &options.environment,
        options.run_command.as_ref(),
    )?;
    let browser = source.browser;
    let profile = options
        .from
        .profile
        .clone()
        .or(source.profile)
        .unwrap_or_else(|| "Default".to_string());
    let is_firefox = is_firefox_browser(&browser);
    let source_profile_dir = resolve_source_profile_dir(&browser, &profile, &options)?;
    let selected = |name: &str| options.include.iter().any(|entry| entry == name);
    let mut report = MigrationReport {
        source: MigrationReportSource {
            browser: browser.clone(),
            profile: profile.clone(),
            user_data_dir: options.from.user_data_dir.clone(),
        },
        target: options.to.clone(),
        migrated: MigratedCounts::default(),
        skipped: Vec::new(),
        warnings: source.warning.into_iter().collect(),
        cookies: Vec::new(),
    };
    let target = options.to.as_path();

    if selected("cookies") {
        if is_firefox {
            let cookies =
                firefox::read_firefox_profile_cookies(&source_profile_dir, &options.domains)?;
            report.migrated.cookies = cookies.len() as u64;
            report.cookies = cookies;
        } else {
            let (cookies, outcome) = cookies::migrate_cookies(
                &cookies::CookieSource {
                    browser: &browser,
                    profile: Some(&profile),
                    source_profile_dir: Some(&source_profile_dir),
                    domains: &options.domains,
                    platform: &options.platform,
                    home_dir: &options.home_dir,
                },
                &options.read_cookies,
            )?;
            report.cookies = cookies;
            report.merge("cookies", outcome);
        }
    }

    if browser_family(&browser)? == "safari" {
        for data_class in ALL_DATA_CLASSES
            .iter()
            .filter(|name| **name != "cookies" && selected(name))
        {
            let (reason, detail) = if *data_class == "passwords" {
                ("safari-password-export-required", "Safari passwords live in the Keychain. Export Passwords from Safari or the Passwords app to CSV; CSV import is tracked separately and is not supported yet.")
            } else {
                ("safari-class-not-supported", "Safari currently supports cookie import only; this data class has not been translated.")
            };
            report
                .skipped
                .push(MigrationEntry::new(*data_class, &browser, reason).with_detail(detail));
        }
        if !report.cookies.is_empty() {
            report.warnings.push(
                MigrationEntry::new("cookies", &browser, "safari-samesite-unavailable")
                    .with_detail(
                        "Cookies.binarycookies does not store SameSite; imported cookies use Lax.",
                    ),
            );
        }
        return Ok(report);
    }

    if selected("bookmarks") {
        let outcome = if is_firefox {
            firefox::migrate_firefox_bookmarks(&source_profile_dir, target)?
        } else {
            bookmarks::migrate_bookmarks(&source_profile_dir, target)?
        };
        report.merge("bookmarks", outcome);
    }

    if selected("history") {
        let outcome = if is_firefox {
            firefox::report_firefox_history(&source_profile_dir)?
        } else {
            history::migrate_history(&source_profile_dir, target)?
        };
        report.merge("history", outcome);
    }

    if selected("preferences") && !is_firefox {
        let outcome = preferences::migrate_preferences(&source_profile_dir, target)?;
        report.merge("preferences", outcome);
    }

    if selected("extensions") && !is_firefox {
        let outcome = extensions::migrate_extensions(&source_profile_dir, target)?;
        report.merge("extensions", outcome);
    }

    if selected("passwords") {
        migrate_passwords_class(&options, &browser, &source_profile_dir, &mut report)?;
    }

    Ok(report)
}

#[cfg(test)]
#[path = "tests/mod.rs"]
mod tests;
