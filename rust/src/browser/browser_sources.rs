//! Catalogue of installed browsers Browser Commander can import from (#114).
//!
//! The data lives in `browser-sources.json`, a shared asset JavaScript, Python
//! and Rust duplicate byte-for-byte (checked by
//! `scripts/check-shared-fingerprint-assets.sh`). This module turns that data
//! into the lookups the rest of the browser code needs: canonical ids with
//! their aliases, the per-platform profile roots, the Chromium Safe Storage
//! identity, and the operating-system identifiers that mark a browser as the
//! system default.
//!
//! Keeping it data-driven is what lets a single JSON edit add Opera, Vivaldi,
//! Arc, a Firefox fork, or a Chrome channel to all three implementations at
//! once, rather than touching hand-written per-platform maps in each language.
//! It mirrors `js/src/browser/browser-sources.js`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use super::browser_profiles::normalize_platform;

/// The shared catalogue source, embedded at compile time.
pub const BROWSER_SOURCES_SOURCE: &str = include_str!("browser-sources.json");

/// Extra environment variables, used when expanding profile-root templates.
pub type Environment = HashMap<String, String>;

/// A snapshot of the process environment, matching JavaScript's `process.env`.
/// Used so `%APPDATA%`/`%LOCALAPPDATA%`/`$XDG_CONFIG_HOME` resolve the same way
/// the default (no-override) code path does.
pub(crate) fn current_environment() -> Environment {
    std::env::vars().collect()
}

/// The Chromium Safe Storage identity for a browser.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SafeStorageIdentity {
    /// Keychain/secret service name (for example `Brave Safe Storage`).
    pub service: String,
    /// Application id used by the Linux secret stores.
    pub application: String,
    /// Keychain folder/account name.
    pub folder: String,
}

/// One browser in the shared catalogue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSource {
    /// Canonical browser id (for example `chrome`, `opera`, `librewolf`).
    pub id: String,
    /// Family (`chromium` or `firefox`).
    pub family: String,
    /// Alternative names that resolve to this browser.
    #[serde(default)]
    pub aliases: Vec<String>,
    /// Whether the browser keeps one profile in the root itself (Opera-style).
    #[serde(default)]
    pub single_profile: bool,
    /// Per-platform profile-root templates keyed by `darwin`/`win32`/`linux`.
    #[serde(default)]
    pub roots: HashMap<String, Vec<String>>,
    /// Chromium Safe Storage identity, absent for Firefox-family browsers.
    #[serde(default)]
    pub safe_storage: Option<SafeStorageIdentity>,
    /// Per-platform operating-system default-browser identifiers.
    #[serde(default)]
    pub default: HashMap<String, Vec<String>>,
    /// Executable basenames used for PATH discovery.
    #[serde(default)]
    pub executable_names: Vec<String>,
    /// Per-platform executable path templates.
    #[serde(default)]
    pub executables: HashMap<String, Vec<String>>,
    /// Required protocol for installed browser control.
    #[serde(default)]
    pub control_protocol: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Catalogue {
    browsers: Vec<BrowserSource>,
}

struct Registry {
    browsers: Vec<BrowserSource>,
    by_name: HashMap<String, usize>,
}

static REGISTRY: LazyLock<Registry> = LazyLock::new(|| {
    let catalogue: Catalogue = serde_json::from_str(BROWSER_SOURCES_SOURCE)
        .expect("browser-sources.json is embedded at compile time and has to parse");
    let mut by_name = HashMap::new();
    for (index, browser) in catalogue.browsers.iter().enumerate() {
        by_name.insert(browser.id.clone(), index);
        for alias in &browser.aliases {
            by_name.insert(alias.clone(), index);
        }
    }
    Registry {
        browsers: catalogue.browsers,
        by_name,
    }
});

/// Browsers whose on-disk cookie stores can be imported, in catalogue order.
/// Mirrors `SUPPORTED_COOKIE_BROWSERS`/`BROWSER_IDS` in the JavaScript library.
pub static SUPPORTED_COOKIE_BROWSERS: LazyLock<Vec<&'static str>> = LazyLock::new(browser_ids);

/// Every known browser, in catalogue order.
pub fn browser_sources() -> &'static [BrowserSource] {
    &REGISTRY.browsers
}

/// Canonical browser ids, in catalogue order.
pub fn browser_ids() -> Vec<&'static str> {
    REGISTRY.browsers.iter().map(|b| b.id.as_str()).collect()
}

/// Resolve a name (canonical id or alias) to its catalogue entry.
pub fn find_browser_source(name: &str) -> Option<&'static BrowserSource> {
    REGISTRY
        .by_name
        .get(name)
        .or_else(|| REGISTRY.by_name.get(&name.to_lowercase()))
        .map(|&index| &REGISTRY.browsers[index])
}

fn normalize_browser_source(name: &str) -> Result<&'static BrowserSource> {
    find_browser_source(name).ok_or_else(|| {
        anyhow!(
            "Unsupported browser: {name}. Expected one of {}",
            browser_ids().join(", ")
        )
    })
}

/// Resolve a name to its canonical id, erroring with the catalogue listed.
pub fn normalize_browser_id(name: &str) -> Result<&'static str> {
    Ok(normalize_browser_source(name)?.id.as_str())
}

/// The family (`chromium` or `firefox`) of a browser name.
pub fn browser_family(name: &str) -> Result<&'static str> {
    Ok(normalize_browser_source(name)?.family.as_str())
}

/// True when a browser stores one profile in the root itself (Opera-style).
pub fn is_single_profile_browser(name: &str) -> Result<bool> {
    Ok(normalize_browser_source(name)?.single_profile)
}

/// The Chromium Safe Storage identity for a browser, or `None` for a
/// Firefox-family browser (which does not use OSCrypt).
pub fn safe_storage_identity(name: &str) -> Result<Option<&'static SafeStorageIdentity>> {
    Ok(normalize_browser_source(name)?.safe_storage.as_ref())
}

/// The operating-system identifiers that mark a browser as the system default:
/// macOS bundle ids, Linux `.desktop` file names, or Windows ProgIds.
pub fn default_browser_identifiers(name: &str, platform: &str) -> Result<Vec<&'static str>> {
    Ok(normalize_browser_source(name)?
        .default
        .get(platform)
        .map(|ids| ids.iter().map(String::as_str).collect())
        .unwrap_or_default())
}

fn separator(platform: &str) -> char {
    if platform == "win32" {
        '\\'
    } else {
        '/'
    }
}

fn join_with(base: &str, parts: &[&str], separator: char) -> String {
    let mut result = base.to_string();
    for part in parts {
        result.push(separator);
        result.push_str(part);
    }
    result
}

fn template_variables(
    platform: &str,
    home_dir: &str,
    environment: &Environment,
) -> HashMap<&'static str, String> {
    let mut variables = HashMap::new();
    variables.insert("home", home_dir.to_string());
    match platform {
        "darwin" => {
            variables.insert(
                "appSupport",
                join_with(home_dir, &["Library", "Application Support"], '/'),
            );
        }
        "win32" => {
            for (variable, key) in [
                ("programFiles", "PROGRAMFILES"),
                ("programFilesX86", "PROGRAMFILES(X86)"),
            ] {
                if let Some(value) = environment.get(key) {
                    variables.insert(variable, value.clone());
                }
            }
            variables.insert(
                "localAppData",
                environment
                    .get("LOCALAPPDATA")
                    .cloned()
                    .unwrap_or_else(|| join_with(home_dir, &["AppData", "Local"], '\\')),
            );
            variables.insert(
                "appData",
                environment
                    .get("APPDATA")
                    .cloned()
                    .unwrap_or_else(|| join_with(home_dir, &["AppData", "Roaming"], '\\')),
            );
        }
        _ => {
            variables.insert(
                "config",
                environment
                    .get("XDG_CONFIG_HOME")
                    .cloned()
                    .unwrap_or_else(|| join_with(home_dir, &[".config"], '/')),
            );
        }
    }
    variables
}

fn expand_template(
    template: &str,
    variables: &HashMap<&'static str, String>,
    separator: char,
) -> Option<String> {
    if !template.starts_with('{') {
        return Some(template.to_string());
    }
    let end = template.find('}')?;
    let key = &template[1..end];
    let base = variables.get(key)?;
    let parts: Vec<&str> = template[end + 1..]
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    Some(join_with(base, &parts, separator))
}

/// The absolute profile roots a browser uses on a platform. Returns an empty
/// vector when the browser does not run on that platform (for example Chrome
/// Canary on Linux). Windows roots are built with backslashes regardless of the
/// host, so the catalogue resolves identically on any platform.
pub fn resolve_browser_roots(
    name: &str,
    platform: &str,
    home_dir: &str,
    environment: &Environment,
) -> Result<Vec<PathBuf>> {
    let platform = normalize_platform(platform);
    let source = normalize_browser_source(name)?;
    let Some(templates) = source.roots.get(platform) else {
        return Ok(Vec::new());
    };
    let variables = template_variables(platform, home_dir, environment);
    let separator = separator(platform);
    Ok(templates
        .iter()
        .filter_map(|template| expand_template(template, &variables, separator))
        .map(PathBuf::from)
        .collect())
}

/// Executable paths from the shared catalogue, with PATH fallback.
pub fn resolve_browser_executables(
    name: &str,
    platform: &str,
    home_dir: &str,
    environment: &Environment,
) -> Result<Vec<PathBuf>> {
    let platform = normalize_platform(platform);
    let source = normalize_browser_source(name)?;
    let variables = template_variables(platform, home_dir, environment);
    let sep = separator(platform);
    let mut candidates: Vec<PathBuf> = source
        .executables
        .get(platform)
        .into_iter()
        .flatten()
        .filter_map(|template| expand_template(template, &variables, sep))
        .map(PathBuf::from)
        .collect();
    for directory in environment
        .get("PATH")
        .map(String::as_str)
        .unwrap_or_default()
        .split(if platform == "win32" { ';' } else { ':' })
        .filter(|entry| !entry.is_empty())
    {
        for name in &source.executable_names {
            let executable = if platform == "win32" {
                format!("{name}.exe")
            } else {
                name.clone()
            };
            candidates.push(PathBuf::from(join_with(directory, &[&executable], sep)));
        }
    }
    let mut seen = std::collections::HashSet::new();
    candidates.retain(|entry| seen.insert(entry.clone()));
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    // feature-parity: sources.catalogue@native-typed
    use super::*;

    fn env(pairs: &[(&str, &str)]) -> Environment {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect()
    }

    fn roots(name: &str, platform: &str, home: &str, environment: &[(&str, &str)]) -> Vec<String> {
        resolve_browser_roots(name, platform, home, &env(environment))
            .unwrap()
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn keeps_the_original_five_browsers_resolvable_by_id_and_alias() {
        assert_eq!(normalize_browser_id("chrome").unwrap(), "chrome");
        assert_eq!(normalize_browser_id("msedge").unwrap(), "edge");
        assert_eq!(normalize_browser_id("microsoft-edge").unwrap(), "edge");
        assert_eq!(normalize_browser_id("google-chrome").unwrap(), "chrome");
        assert_eq!(normalize_browser_id("CHROME").unwrap(), "chrome");
    }

    #[test]
    fn adds_the_new_source_browsers_from_114() {
        for id in [
            "opera",
            "opera-gx",
            "vivaldi",
            "arc",
            "yandex",
            "chrome-beta",
            "chrome-dev",
            "chrome-canary",
            "edge-beta",
            "edge-dev",
            "librewolf",
            "waterfox",
            "zen",
            "floorp",
            "firefox-developer",
            "firefox-nightly",
        ] {
            assert!(browser_ids().contains(&id), "missing {id}");
            assert!(find_browser_source(id).is_some(), "unresolvable {id}");
        }
    }

    #[test]
    fn rejects_an_unknown_browser_with_the_catalogue_listed() {
        let error = normalize_browser_id("netscape").unwrap_err().to_string();
        assert!(
            error.starts_with("Unsupported browser: netscape. Expected one of"),
            "{error}"
        );
        assert!(error.contains("chrome"), "{error}");
    }

    #[test]
    fn classifies_browser_families() {
        assert_eq!(browser_family("chrome").unwrap(), "chromium");
        assert_eq!(browser_family("opera").unwrap(), "chromium");
        assert_eq!(browser_family("firefox").unwrap(), "firefox");
        assert_eq!(browser_family("librewolf").unwrap(), "firefox");
    }

    #[test]
    fn expands_per_platform_roots_with_the_home_directory() {
        assert_eq!(
            roots("chrome", "linux", "/home/me", &[]),
            ["/home/me/.config/google-chrome"]
        );
        assert_eq!(
            roots("firefox", "darwin", "/Users/me", &[]),
            ["/Users/me/Library/Application Support/Firefox"]
        );
    }

    #[test]
    fn honours_xdg_config_home_on_linux() {
        assert_eq!(
            roots(
                "chromium",
                "linux",
                "/home/me",
                &[("XDG_CONFIG_HOME", "/cfg")]
            ),
            ["/cfg/chromium"]
        );
    }

    #[test]
    fn builds_windows_roots_with_backslashes() {
        assert_eq!(
            roots(
                "opera",
                "win32",
                "C:\\Users\\me",
                &[("APPDATA", "C:\\Users\\me\\AppData\\Roaming")]
            ),
            ["C:\\Users\\me\\AppData\\Roaming\\Opera Software\\Opera Stable"]
        );
        assert_eq!(
            roots(
                "chrome",
                "win32",
                "C:\\Users\\me",
                &[("LOCALAPPDATA", "C:\\Users\\me\\AppData\\Local")]
            ),
            ["C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data"]
        );
    }

    #[test]
    fn returns_no_root_where_a_browser_does_not_run() {
        assert!(roots("chrome-canary", "linux", "/home/me", &[]).is_empty());
        assert!(roots("arc", "linux", "/home/me", &[]).is_empty());
    }

    #[test]
    fn marks_opera_style_browsers_as_single_profile() {
        assert!(is_single_profile_browser("opera").unwrap());
        assert!(is_single_profile_browser("opera-gx").unwrap());
        assert!(!is_single_profile_browser("chrome").unwrap());
        assert!(!is_single_profile_browser("vivaldi").unwrap());
    }

    #[test]
    fn exposes_a_safe_storage_identity_for_chromium_and_none_for_firefox() {
        assert_eq!(
            safe_storage_identity("brave").unwrap(),
            Some(&SafeStorageIdentity {
                service: "Brave Safe Storage".into(),
                application: "brave".into(),
                folder: "Brave Keys".into(),
            })
        );
        assert_eq!(safe_storage_identity("firefox").unwrap(), None);
    }

    #[test]
    fn exposes_default_browser_identifiers_per_platform() {
        assert_eq!(
            default_browser_identifiers("chrome", "darwin").unwrap(),
            ["com.google.chrome"]
        );
        assert_eq!(
            default_browser_identifiers("firefox", "win32").unwrap(),
            ["FirefoxHTML", "FirefoxURL"]
        );
        assert!(default_browser_identifiers("chrome", "nope")
            .unwrap()
            .is_empty());
    }
}
