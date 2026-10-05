//! Discovery of installed browser profiles that contain cookie databases.
//!
//! Driven by the shared `browser-sources.json` catalogue (#114), so adding a
//! browser there adds it to discovery, including Opera-style single-profile
//! layouts and Firefox forks. Mirrors `js/src/browser/browser-profiles.js`.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use serde::Deserialize;

use super::browser_sources::{
    browser_family, browser_ids, current_environment, is_single_profile_browser,
    normalize_browser_id, resolve_browser_roots, Environment,
};
use super::default_browser::{default_run_command, resolve_default_browser, RunCommand};

/// Browsers whose on-disk cookie stores can be imported, driven by the shared
/// catalogue. Re-exported here so the name callers already use keeps working.
pub use super::browser_sources::SUPPORTED_COOKIE_BROWSERS;

/// Keywords that select the operating-system default browser instead of a named
/// one, so `browser: "default"` (or `"auto"`) imports from whatever a person
/// actually uses.
const DEFAULT_BROWSER_KEYWORDS: [&str; 2] = ["default", "auto"];

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
#[derive(Clone)]
pub struct BrowserProfileOptions {
    /// Restrict discovery to one browser. `None` scans all supported browsers.
    pub browser: Option<String>,
    /// Home directory used to resolve conventional profile locations.
    pub home_dir: PathBuf,
    /// Platform path convention (`linux`, `darwin`, or `win32`).
    pub platform: String,
    /// Environment used to expand profile-root templates (`%APPDATA%`, ...).
    pub environment: Environment,
    /// Command runner used to resolve the system default browser, injectable
    /// for deterministic tests. `None` uses a real subprocess.
    pub run_command: Option<RunCommand>,
}

impl std::fmt::Debug for BrowserProfileOptions {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BrowserProfileOptions")
            .field("browser", &self.browser)
            .field("home_dir", &self.home_dir)
            .field("platform", &self.platform)
            .field("environment", &self.environment)
            .field("run_command", &self.run_command.as_ref().map(|_| "<fn>"))
            .finish()
    }
}

impl Default for BrowserProfileOptions {
    fn default() -> Self {
        Self {
            browser: None,
            home_dir: dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
            platform: current_platform().to_string(),
            environment: current_environment(),
            run_command: None,
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

/// Resolve a browser name (id or alias) to its canonical catalogue id.
pub(crate) fn normalize_cookie_browser(browser: &str) -> Result<&'static str> {
    normalize_browser_id(browser)
}

/// Whether `browser` asks for the system default rather than a named browser.
pub fn is_default_browser_keyword(browser: &str) -> bool {
    let needle = browser.trim().to_lowercase();
    DEFAULT_BROWSER_KEYWORDS.contains(&needle.as_str())
}

/// Resolve a requested browser to a canonical catalogue id, expanding the
/// `default`/`auto` keywords to the operating-system default browser. Named
/// browsers are normalized through the catalogue as before.
pub fn resolve_source_browser(
    browser: &str,
    platform: &str,
    environment: &Environment,
    run_command: Option<&RunCommand>,
) -> Result<&'static str> {
    if !is_default_browser_keyword(browser) {
        return normalize_cookie_browser(browser);
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
    resolve_default_browser(platform, environment, runner)?.ok_or_else(|| {
        anyhow!(
            "Could not determine the system default browser; pass an explicit browser instead of \"default\"."
        )
    })
}

/// The primary profile root a browser uses on a platform.
pub(crate) fn browser_profile_root(
    browser: &str,
    platform: &str,
    home_dir: &Path,
) -> Result<PathBuf> {
    let browser = normalize_browser_id(browser)?;
    let environment = current_environment();
    resolve_browser_roots(browser, platform, &home_dir.to_string_lossy(), &environment)?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("{browser} has no profile root on {platform}"))
}

pub(crate) fn find_cookie_database(browser: &str, profile_path: &Path) -> Option<PathBuf> {
    if browser_family(browser)
        .map(|family| family == "firefox")
        .unwrap_or(false)
    {
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
    // Opera-style browsers keep one profile in the root itself rather than in
    // Default/Profile N subdirectories.
    if is_single_profile_browser(browser).unwrap_or(false) {
        return match find_cookie_database(browser, root) {
            Some(_) => vec![BrowserProfile {
                browser: browser.to_string(),
                name: "Default".to_string(),
                display_name: "Default".to_string(),
                path: root.to_path_buf(),
                is_default: true,
            }],
            None => Vec::new(),
        };
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
            if !line.starts_with(';') {
                section.insert(key.trim().into(), value.trim().into());
            }
        }
    }
    if let Some(section) = current {
        sections.push(section);
    }
    sections
}

fn firefox_sections(root: &Path) -> Vec<BTreeMap<String, String>> {
    if let Ok(contents) = fs::read_to_string(root.join("profiles.ini")) {
        return parse_ini(&contents);
    }
    // No profiles.ini (some forks): fall back to the Profiles directory.
    let profiles_root = root.join("Profiles");
    let Ok(entries) = fs::read_dir(&profiles_root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let mut section = BTreeMap::new();
            section.insert("section".into(), "Profile".into());
            section.insert("Name".into(), name.clone());
            section.insert("Path".into(), name);
            section.insert(
                "ProfilesRoot".into(),
                profiles_root.to_string_lossy().into_owned(),
            );
            Some(section)
        })
        .collect()
}

fn list_firefox_profiles(browser: &str, root: &Path) -> Vec<BrowserProfile> {
    if !root.is_dir() {
        return Vec::new();
    }
    let mut profiles = firefox_sections(root)
        .into_iter()
        .filter(|section| {
            section
                .get("section")
                .is_some_and(|name| name.starts_with("Profile"))
        })
        .filter_map(|section| {
            let configured = section.get("Path")?;
            let relative_root = section
                .get("ProfilesRoot")
                .map(PathBuf::from)
                .unwrap_or_else(|| root.to_path_buf());
            let path = if section.get("IsRelative").map(String::as_str) == Some("0") {
                PathBuf::from(configured)
            } else {
                relative_root.join(configured)
            };
            find_cookie_database(browser, &path)?;
            let display_name = section
                .get("Name")
                .cloned()
                .or_else(|| path.file_name()?.to_str().map(String::from))?;
            Some(BrowserProfile {
                browser: browser.to_string(),
                name: display_name.clone(),
                display_name,
                path,
                is_default: section.get("Default").map(String::as_str) == Some("1"),
            })
        })
        .collect::<Vec<_>>();
    profiles.sort_by_key(|profile| (!profile.is_default, profile.name.clone()));
    profiles
}

fn list_profiles_for_browser(
    browser: &str,
    platform: &str,
    home_dir: &Path,
    environment: &Environment,
) -> Result<Vec<BrowserProfile>> {
    let roots = resolve_browser_roots(browser, platform, &home_dir.to_string_lossy(), environment)?;
    let family = browser_family(browser)?;
    let mut profiles = Vec::new();
    for root in roots {
        if family == "firefox" {
            profiles.extend(list_firefox_profiles(browser, &root));
        } else {
            profiles.extend(list_chromium_profiles(browser, &root));
        }
    }
    Ok(profiles)
}

/// Discover cookie-bearing profiles from installed browsers. When `browser` is
/// unset, every browser in the shared catalogue is scanned.
pub fn list_browser_profiles(options: BrowserProfileOptions) -> Result<Vec<BrowserProfile>> {
    let browsers: Vec<&'static str> = match options.browser.as_deref() {
        Some(browser) => vec![resolve_source_browser(
            browser,
            &options.platform,
            &options.environment,
            options.run_command.as_ref(),
        )?],
        None => browser_ids(),
    };
    let mut profiles = Vec::new();
    // Several Firefox channels (firefox, firefox-developer, firefox-nightly)
    // share one profile root, so a catalogue-wide scan would otherwise report
    // the same profile under each id. Keep the first (canonical) browser.
    let mut seen: HashSet<PathBuf> = HashSet::new();
    for browser in browsers {
        for profile in list_profiles_for_browser(
            browser,
            &options.platform,
            &options.home_dir,
            &options.environment,
        )? {
            if seen.insert(profile.path.clone()) {
                profiles.push(profile);
            }
        }
    }
    Ok(profiles)
}

pub(crate) fn resolve_browser_profile(
    browser: &str,
    requested_profile: Option<&str>,
    options: &BrowserProfileOptions,
) -> Result<BrowserProfile> {
    let browser = resolve_source_browser(
        browser,
        &options.platform,
        &options.environment,
        options.run_command.as_ref(),
    )?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

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

    fn write(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).expect("parent");
        fs::write(path, contents).expect("write");
    }

    fn write_firefox_profile(home: &Path, root_name: &[&str], profile_name: &str) -> PathBuf {
        let mut root = home.to_path_buf();
        for part in root_name {
            root = root.join(part);
        }
        let profile_path = root.join(profile_name);
        fs::create_dir_all(&profile_path).expect("profile dir");
        write(
            &root.join("profiles.ini"),
            &format!(
                "[Profile0]\nName={}\nIsRelative=1\nPath={profile_name}\nDefault=1\n",
                profile_name
                    .split_once('.')
                    .map(|(_, name)| name)
                    .unwrap_or(profile_name)
            ),
        );
        fs::write(profile_path.join("cookies.sqlite"), b"SQLite format 3\0").expect("cookies");
        profile_path
    }

    fn options(home: &Path) -> BrowserProfileOptions {
        BrowserProfileOptions {
            browser: None,
            home_dir: home.to_path_buf(),
            platform: "linux".to_string(),
            environment: Environment::new(),
            run_command: None,
        }
    }

    #[test]
    fn reads_an_opera_single_profile_layout_from_the_root_itself() {
        let temp = TempDir::new("bc-opera-");
        let root = temp.path().join(".config").join("opera");
        fs::create_dir_all(root.join("Network")).expect("network");
        fs::write(root.join("Network").join("Cookies"), b"SQLite format 3\0").expect("cookies");

        let profiles = list_browser_profiles(options(temp.path()).browser("opera")).unwrap();
        assert_eq!(
            profiles,
            vec![BrowserProfile {
                browser: "opera".into(),
                name: "Default".into(),
                display_name: "Default".into(),
                path: root,
                is_default: true,
            }]
        );
    }

    #[test]
    fn discovers_a_firefox_fork_librewolf_by_its_own_root() {
        let temp = TempDir::new("bc-librewolf-");
        let profile_path = write_firefox_profile(temp.path(), &[".librewolf"], "abcd.default");

        let profiles = list_browser_profiles(options(temp.path()).browser("librewolf")).unwrap();
        assert_eq!(
            profiles,
            vec![BrowserProfile {
                browser: "librewolf".into(),
                name: "default".into(),
                display_name: "default".into(),
                path: profile_path,
                is_default: true,
            }]
        );
    }

    #[test]
    fn lists_firefox_once_when_its_channels_share_a_root() {
        let temp = TempDir::new("bc-ffshare-");
        write_firefox_profile(temp.path(), &[".mozilla", "firefox"], "xyz.default-release");

        let profiles = list_browser_profiles(options(temp.path())).unwrap();
        let browsers: Vec<&str> = profiles
            .iter()
            .filter(|profile| profile.browser.starts_with("firefox"))
            .map(|profile| profile.browser.as_str())
            .collect();
        assert_eq!(browsers, vec!["firefox"]);
    }

    fn firefox_runner() -> RunCommand {
        Arc::new(|command: &str, args: &[&str], _env: &Environment| {
            if command == "xdg-settings" && args == ["get", "default-web-browser"] {
                Ok("firefox.desktop\n".to_string())
            } else {
                Err(anyhow!("unexpected command"))
            }
        })
    }

    #[test]
    fn resolves_browser_default_to_the_system_default_browser() {
        let runner = firefox_runner();
        assert_eq!(
            resolve_source_browser("default", "linux", &Environment::new(), Some(&runner)).unwrap(),
            "firefox"
        );
        assert_eq!(
            resolve_source_browser("AUTO", "linux", &Environment::new(), Some(&runner)).unwrap(),
            "firefox"
        );
    }

    #[test]
    fn lists_the_default_browser_profile_when_browser_is_default() {
        let temp = TempDir::new("bc-default-");
        let profile_path =
            write_firefox_profile(temp.path(), &[".mozilla", "firefox"], "xyz.default-release");
        let runner: RunCommand = Arc::new(|_command: &str, _args: &[&str], _env: &Environment| {
            Ok("firefox.desktop\n".to_string())
        });

        let resolved = resolve_browser_profile(
            "default",
            None,
            &options(temp.path()).run_command(runner.clone()),
        )
        .unwrap();
        assert_eq!(resolved.browser, "firefox");
        assert_eq!(resolved.path, profile_path);

        let profiles =
            list_browser_profiles(options(temp.path()).browser("auto").run_command(runner))
                .unwrap();
        assert_eq!(
            profiles
                .iter()
                .map(|profile| profile.browser.as_str())
                .collect::<Vec<_>>(),
            vec!["firefox"]
        );
    }

    #[test]
    fn reports_a_clear_error_when_the_default_browser_is_unknown() {
        let runner: RunCommand =
            Arc::new(|_command: &str, _args: &[&str], _env: &Environment| Err(anyhow!("no xdg")));
        let error = resolve_source_browser("default", "linux", &Environment::new(), Some(&runner))
            .unwrap_err()
            .to_string();
        assert!(
            error.contains("Could not determine the system default browser"),
            "{error}"
        );
    }
}
