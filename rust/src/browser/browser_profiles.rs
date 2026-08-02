//! Discovery of installed browser profiles that contain cookie databases.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde::Deserialize;

/// Browsers whose on-disk cookie stores can be imported.
pub const SUPPORTED_COOKIE_BROWSERS: [&str; 5] = ["chrome", "edge", "brave", "chromium", "firefox"];

/// Metadata for a cookie-bearing installed browser profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserProfile {
    /// Normalized browser name.
    pub browser: String,
    /// On-disk profile name.
    pub name: String,
    /// Human-readable profile name, when the browser supplies one.
    pub display_name: String,
    /// Absolute or home-relative profile directory.
    pub path: PathBuf,
    /// Whether the browser marks this profile as the default/last used one.
    pub is_default: bool,
}

/// Options for [`list_browser_profiles`].
#[derive(Debug, Clone)]
pub struct BrowserProfileOptions {
    /// Restrict discovery to one browser. `None` scans all supported browsers.
    pub browser: Option<String>,
    /// Home directory used to resolve conventional profile locations.
    pub home_dir: PathBuf,
    /// Platform path convention (`linux`, `darwin`, or `win32`).
    pub platform: String,
}

impl Default for BrowserProfileOptions {
    fn default() -> Self {
        Self {
            browser: None,
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            platform: current_platform().to_string(),
        }
    }
}

impl BrowserProfileOptions {
    /// Restrict discovery to one installed browser.
    pub fn browser(mut self, browser: impl Into<String>) -> Self {
        self.browser = Some(browser.into());
        self
    }

    /// Override the home directory used for discovery.
    pub fn home_dir(mut self, home_dir: impl Into<PathBuf>) -> Self {
        self.home_dir = home_dir.into();
        self
    }

    /// Override the platform convention, primarily for portable tooling/tests.
    pub fn platform(mut self, platform: impl AsRef<str>) -> Self {
        self.platform = normalize_platform(platform.as_ref()).to_string();
        self
    }
}

pub(crate) fn current_platform() -> &'static str {
    normalize_platform(std::env::consts::OS)
}

pub(crate) fn normalize_platform(platform: &str) -> &str {
    match platform {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

pub(crate) fn normalize_cookie_browser(browser: &str) -> Result<&str> {
    let normalized = if browser == "msedge" { "edge" } else { browser };
    if SUPPORTED_COOKIE_BROWSERS.contains(&normalized) {
        Ok(normalized)
    } else {
        Err(anyhow!(
            "Unsupported browser: {browser}. Expected one of {}",
            SUPPORTED_COOKIE_BROWSERS.join(", ")
        ))
    }
}

pub(crate) fn browser_profile_root(
    browser: &str,
    platform: &str,
    home_dir: &Path,
) -> Result<PathBuf> {
    let browser = normalize_cookie_browser(browser)?;
    let local = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.join("AppData/Local"));
    let roaming = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir.join("AppData/Roaming"));
    let support = home_dir.join("Library/Application Support");
    let root = match (normalize_platform(platform), browser) {
        ("darwin", "chrome") => support.join("Google/Chrome"),
        ("darwin", "edge") => support.join("Microsoft Edge"),
        ("darwin", "brave") => support.join("BraveSoftware/Brave-Browser"),
        ("darwin", "chromium") => support.join("Chromium"),
        ("darwin", "firefox") => support.join("Firefox"),
        ("win32", "chrome") => local.join("Google/Chrome/User Data"),
        ("win32", "edge") => local.join("Microsoft/Edge/User Data"),
        ("win32", "brave") => local.join("BraveSoftware/Brave-Browser/User Data"),
        ("win32", "chromium") => local.join("Chromium/User Data"),
        ("win32", "firefox") => roaming.join("Mozilla/Firefox"),
        (_, "chrome") => home_dir.join(".config/google-chrome"),
        (_, "edge") => home_dir.join(".config/microsoft-edge"),
        (_, "brave") => home_dir.join(".config/BraveSoftware/Brave-Browser"),
        (_, "chromium") => home_dir.join(".config/chromium"),
        (_, "firefox") => home_dir.join(".mozilla/firefox"),
        _ => unreachable!(),
    };
    Ok(root)
}

pub(crate) fn find_cookie_database(browser: &str, profile_path: &Path) -> Option<PathBuf> {
    if browser == "firefox" {
        let candidate = profile_path.join("cookies.sqlite");
        return candidate.is_file().then_some(candidate);
    }
    [
        profile_path.join("Network/Cookies"),
        profile_path.join("Cookies"),
    ]
    .into_iter()
    .find(|candidate| candidate.is_file())
}

#[derive(Debug, Default, Deserialize)]
struct LocalState {
    #[serde(default)]
    profile: LocalStateProfile,
}

#[derive(Debug, Default, Deserialize)]
struct LocalStateProfile {
    last_used: Option<String>,
    #[serde(default)]
    info_cache: BTreeMap<String, LocalStateProfileInfo>,
}

#[derive(Debug, Default, Deserialize)]
struct LocalStateProfileInfo {
    name: Option<String>,
}

fn list_chromium_profiles(browser: &str, root: &Path) -> Vec<BrowserProfile> {
    if !root.is_dir() {
        return Vec::new();
    }
    let state = fs::read_to_string(root.join("Local State"))
        .ok()
        .and_then(|contents| serde_json::from_str::<LocalState>(&contents).ok())
        .unwrap_or_default();
    let mut names = state
        .profile
        .info_cache
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    if let Ok(entries) = fs::read_dir(root) {
        for name in entries
            .flatten()
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name == "Default" || name.starts_with("Profile "))
        {
            names.insert(name);
        }
    }
    let default_name = state.profile.last_used.as_deref().unwrap_or("Default");
    let only_default = names.len() == 1 && names.contains("Default");
    let mut profiles = names
        .into_iter()
        .filter_map(|name| {
            let path = root.join(&name);
            find_cookie_database(browser, &path)?;
            let display_name = state
                .profile
                .info_cache
                .get(&name)
                .and_then(|info| info.name.clone())
                .unwrap_or_else(|| name.clone());
            Some(BrowserProfile {
                browser: browser.to_string(),
                is_default: name == default_name || (only_default && name == "Default"),
                name,
                display_name,
                path,
            })
        })
        .collect::<Vec<_>>();
    profiles.sort_by_key(|profile| (!profile.is_default, profile.name.clone()));
    profiles
}

fn parse_ini(contents: &str) -> Vec<BTreeMap<String, String>> {
    let mut sections = Vec::new();
    let mut current: Option<BTreeMap<String, String>> = None;
    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            if let Some(section) = current.take() {
                sections.push(section);
            }
            let mut section = BTreeMap::new();
            section.insert("section".into(), line[1..line.len() - 1].into());
            current = Some(section);
        } else if let (Some(section), Some((key, value))) = (current.as_mut(), line.split_once('='))
        {
            section.insert(key.trim().into(), value.trim().into());
        }
    }
    if let Some(section) = current {
        sections.push(section);
    }
    sections
}

fn list_firefox_profiles(root: &Path) -> Vec<BrowserProfile> {
    let contents = match fs::read_to_string(root.join("profiles.ini")) {
        Ok(contents) => contents,
        Err(_) => return Vec::new(),
    };
    let mut profiles = parse_ini(&contents)
        .into_iter()
        .filter(|section| {
            section
                .get("section")
                .is_some_and(|name| name.starts_with("Profile"))
        })
        .filter_map(|section| {
            let configured = PathBuf::from(section.get("Path")?);
            let path = if section.get("IsRelative").map(String::as_str) == Some("0") {
                configured
            } else {
                root.join(configured)
            };
            find_cookie_database("firefox", &path)?;
            let name = section
                .get("Name")
                .cloned()
                .or_else(|| path.file_name()?.to_str().map(String::from))?;
            Some(BrowserProfile {
                browser: "firefox".into(),
                name: name.clone(),
                display_name: name,
                path,
                is_default: section.get("Default").map(String::as_str) == Some("1"),
            })
        })
        .collect::<Vec<_>>();
    profiles.sort_by_key(|profile| (!profile.is_default, profile.name.clone()));
    profiles
}

/// Discover cookie-bearing profiles for Chrome, Edge, Brave, Chromium, and Firefox.
pub fn list_browser_profiles(options: BrowserProfileOptions) -> Result<Vec<BrowserProfile>> {
    let browsers = match options.browser.as_deref() {
        Some(browser) => vec![normalize_cookie_browser(browser)?],
        None => SUPPORTED_COOKIE_BROWSERS.to_vec(),
    };
    let mut profiles = Vec::new();
    for browser in browsers {
        let root = browser_profile_root(browser, &options.platform, &options.home_dir)?;
        if browser == "firefox" {
            profiles.extend(list_firefox_profiles(&root));
        } else {
            profiles.extend(list_chromium_profiles(browser, &root));
        }
    }
    Ok(profiles)
}

pub(crate) fn resolve_browser_profile(
    browser: &str,
    requested_profile: Option<&str>,
    options: &BrowserProfileOptions,
) -> Result<BrowserProfile> {
    let profiles = list_browser_profiles(options.clone().browser(browser))?;
    let selected = requested_profile
        .and_then(|requested| {
            profiles.iter().find(|profile| {
                profile.name == requested
                    || profile.display_name == requested
                    || profile.path.file_name().and_then(|name| name.to_str()) == Some(requested)
            })
        })
        .or_else(|| profiles.iter().find(|profile| profile.is_default))
        .or_else(|| profiles.first());
    selected.cloned().ok_or_else(|| {
        let detail = requested_profile
            .map(|profile| format!(" profile \"{profile}\""))
            .unwrap_or_else(|| " profile".into());
        anyhow!("Could not find a cookie database for {browser}{detail}")
    })
}
