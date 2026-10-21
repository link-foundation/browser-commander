//! Chrome for Testing: recognising it by its install path, the restrictions
//! a launch of it gets by default, and finding it in the engines' download
//! caches (issue #179).
//!
//! Chrome for Testing shows a "Chrome for Testing is only for automated
//! testing" infobar that Chromium skips only for `--test-type=gpu`, and on
//! macOS it asks for the keychain. A launch that starts it therefore gets the
//! [`CHROME_FOR_TESTING_PRESET`] restrictions unless the caller chose its own
//! [`default_restrictions`](super::real_browser::RealBrowserOptions::default_restrictions).
//!
//! Mirrors `isChromeForTesting` and `defaultRestrictionsFor` in
//! `js/src/browser/launch-executable.js`.

use std::path::{Path, PathBuf};

use crate::browser::restrictions::launch_restriction_preset;

/// The restriction preset a Chrome for Testing launch gets by default.
pub const CHROME_FOR_TESTING_PRESET: &str = "chrome-for-testing";

/// Directories Chrome for Testing archives unpack to.
const CHROME_FOR_TESTING_DIRECTORIES: [&str; 5] = [
    "chrome-linux64",
    "chrome-win64",
    "chrome-win32",
    "chrome-mac-x64",
    "chrome-mac-arm64",
];

/// Platform directories of the Selenium Manager cache.
const SELENIUM_CACHE_PLATFORMS: [&str; 5] = ["linux64", "win64", "win32", "mac-x64", "mac-arm64"];

/// Whether `path` is a Chrome for Testing binary, judged by where it is
/// installed: inside a `Google Chrome for Testing.app` bundle, a
/// `chrome-<platform>` archive directory, or the Selenium Manager cache
/// (`selenium/chrome/<platform>/<version>`). Both `/` and `\` separate
/// segments, whatever the host platform.
pub fn is_chrome_for_testing(path: &Path) -> bool {
    let text = path.to_string_lossy().to_lowercase();
    let segments: Vec<&str> = text
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.iter().any(|segment| {
        segment.contains("chrome for testing") || CHROME_FOR_TESTING_DIRECTORIES.contains(segment)
    }) {
        return true;
    }
    let Some(selenium) = segments.iter().rposition(|segment| *segment == "selenium") else {
        return false;
    };
    segments.get(selenium + 1) == Some(&"chrome")
        && segments
            .get(selenium + 2)
            .is_some_and(|platform| SELENIUM_CACHE_PLATFORMS.contains(platform))
}

/// The restriction ids a Chrome for Testing launch gets by default: the
/// [`CHROME_FOR_TESTING_PRESET`] preset, expanded.
pub fn chrome_for_testing_restrictions() -> Vec<String> {
    launch_restriction_preset(CHROME_FOR_TESTING_PRESET)
        .map(<[String]>::to_vec)
        .unwrap_or_default()
}

/// The restrictions a launch of `executable` starts with before the caller's
/// own: `requested` when the caller chose them (an empty list opts out),
/// otherwise [`chrome_for_testing_restrictions`] for Chrome for Testing and
/// nothing for any other browser.
pub fn default_restrictions_for(executable: &Path, requested: Option<&[String]>) -> Vec<String> {
    match requested {
        Some(requested) => requested.to_vec(),
        None if is_chrome_for_testing(executable) => chrome_for_testing_restrictions(),
        None => Vec::new(),
    }
}

/// Whether `path` is a file a launch can start.
pub(crate) fn is_executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path)
            .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// The platforms Chrome for Testing is built for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CachePlatform {
    Linux64,
    MacX64,
    MacArm64,
    Win64,
    Win32,
}

impl CachePlatform {
    /// The platform of this machine, when Chrome for Testing exists for it.
    pub(crate) fn current() -> Option<Self> {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("linux", "x86_64") => Some(Self::Linux64),
            ("macos", "aarch64") => Some(Self::MacArm64),
            ("macos", _) => Some(Self::MacX64),
            ("windows", "x86") => Some(Self::Win32),
            ("windows", _) => Some(Self::Win64),
            _ => None,
        }
    }

    /// The platform name in archive and Selenium cache directories.
    fn name(self) -> &'static str {
        match self {
            Self::Linux64 => "linux64",
            Self::MacX64 => "mac-x64",
            Self::MacArm64 => "mac-arm64",
            Self::Win64 => "win64",
            Self::Win32 => "win32",
        }
    }

    /// The platform name Puppeteer prefixes its cache directories with.
    fn puppeteer_name(self) -> &'static str {
        match self {
            Self::Linux64 => "linux",
            Self::MacX64 => "mac",
            Self::MacArm64 => "mac_arm",
            Self::Win64 => "win64",
            Self::Win32 => "win32",
        }
    }

    /// The binary inside an unpacked Chrome for Testing directory.
    fn binary(self) -> PathBuf {
        match self {
            Self::Linux64 => PathBuf::from("chrome"),
            Self::MacX64 | Self::MacArm64 => Path::new("Google Chrome for Testing.app")
                .join("Contents")
                .join("MacOS")
                .join("Google Chrome for Testing"),
            Self::Win64 | Self::Win32 => PathBuf::from("chrome.exe"),
        }
    }

    fn is_mac(self) -> bool {
        matches!(self, Self::MacX64 | Self::MacArm64)
    }

    fn is_windows(self) -> bool {
        matches!(self, Self::Win64 | Self::Win32)
    }
}

/// A download cache Chrome for Testing can be found in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChromeForTestingCache {
    /// `npx playwright install chromium`.
    Playwright,
    /// `npx puppeteer browsers install chrome`.
    Puppeteer,
    /// Selenium Manager.
    Selenium,
}

/// Where the download caches are on this machine: the home directory, the
/// platform and the environment variables that move a cache.
#[derive(Debug, Clone)]
pub(crate) struct CacheLocations {
    pub(crate) platform: CachePlatform,
    pub(crate) home: Option<PathBuf>,
    pub(crate) env: std::collections::HashMap<String, String>,
}

impl CacheLocations {
    /// The caches of this machine, or `None` where Chrome for Testing is not
    /// built for the platform.
    pub(crate) fn from_environment() -> Option<Self> {
        let names = [
            "PLAYWRIGHT_BROWSERS_PATH",
            "PUPPETEER_CACHE_DIR",
            "SE_CACHE_PATH",
            "XDG_CACHE_HOME",
            "LOCALAPPDATA",
        ];
        Some(Self {
            platform: CachePlatform::current()?,
            home: dirs::home_dir(),
            env: names
                .into_iter()
                .filter_map(|name| {
                    std::env::var(name)
                        .ok()
                        .filter(|value| !value.is_empty())
                        .map(|value| (name.to_string(), value))
                })
                .collect(),
        })
    }

    fn var(&self, name: &str) -> Option<PathBuf> {
        self.env
            .get(name)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
    }

    fn home(&self, relative: &[&str]) -> Option<PathBuf> {
        let mut path = self.home.clone()?;
        path.extend(relative);
        Some(path)
    }

    fn playwright_root(&self) -> Option<PathBuf> {
        if let Some(root) = self.env.get("PLAYWRIGHT_BROWSERS_PATH") {
            // `0` keeps the browsers inside node_modules, where only the
            // Playwright package itself knows the path.
            return (root != "0").then(|| PathBuf::from(root));
        }
        if self.platform.is_windows() {
            return self
                .var("LOCALAPPDATA")
                .map(|local| local.join("ms-playwright"));
        }
        if self.platform.is_mac() {
            return self.home(&["Library", "Caches", "ms-playwright"]);
        }
        self.var("XDG_CACHE_HOME")
            .map(|cache| cache.join("ms-playwright"))
            .or_else(|| self.home(&[".cache", "ms-playwright"]))
    }

    fn puppeteer_root(&self) -> Option<PathBuf> {
        self.var("PUPPETEER_CACHE_DIR")
            .or_else(|| self.home(&[".cache", "puppeteer"]))
    }

    fn selenium_root(&self) -> Option<PathBuf> {
        self.var("SE_CACHE_PATH")
            .or_else(|| self.home(&[".cache", "selenium"]))
    }

    /// Chrome for Testing binaries in `cache`, newest version first. Only
    /// existing executables that [`is_chrome_for_testing`] accepts are listed.
    pub(crate) fn find(&self, cache: ChromeForTestingCache) -> Vec<PathBuf> {
        let platform = self.platform;
        let archive = format!("chrome-{}", platform.name());
        let candidates = match cache {
            ChromeForTestingCache::Playwright => {
                self.playwright_root().map_or_else(Vec::new, |root| {
                    newest_first(&root, |name| {
                        name.strip_prefix("chromium-").and_then(version_key)
                    })
                    .into_iter()
                    .map(|directory| directory.join(&archive).join(platform.binary()))
                    .collect()
                })
            }
            ChromeForTestingCache::Puppeteer => {
                self.puppeteer_root().map_or_else(Vec::new, |root| {
                    let prefix = format!("{}-", platform.puppeteer_name());
                    newest_first(&root.join("chrome"), |name| {
                        name.strip_prefix(&prefix).and_then(version_key)
                    })
                    .into_iter()
                    .map(|directory| directory.join(&archive).join(platform.binary()))
                    .collect()
                })
            }
            ChromeForTestingCache::Selenium => self.selenium_root().map_or_else(Vec::new, |root| {
                newest_first(&root.join("chrome").join(platform.name()), version_key)
                    .into_iter()
                    .map(|directory| directory.join(platform.binary()))
                    .collect()
            }),
        };
        candidates
            .into_iter()
            .filter(|path| is_executable_file(path) && is_chrome_for_testing(path))
            .collect()
    }

    /// The chromedrivers Selenium Manager and `@puppeteer/browsers`
    /// downloaded, with their versions, newest first.
    pub(crate) fn chromedrivers(&self) -> Vec<(Vec<u64>, PathBuf)> {
        let platform = self.platform;
        let name = if platform.is_windows() {
            "chromedriver.exe"
        } else {
            "chromedriver"
        };
        let mut drivers: Vec<(Vec<u64>, PathBuf)> = Vec::new();
        if let Some(root) = self.selenium_root() {
            let directory = root.join("chromedriver").join(platform.name());
            drivers.extend(
                versions(&directory, version_key)
                    .into_iter()
                    .map(|(version, directory)| (version, directory.join(name))),
            );
        }
        if let Some(root) = self.puppeteer_root() {
            let prefix = format!("{}-", platform.puppeteer_name());
            let archive = format!("chromedriver-{}", platform.name());
            drivers.extend(
                versions(&root.join("chromedriver"), |directory| {
                    directory.strip_prefix(&prefix).and_then(version_key)
                })
                .into_iter()
                .map(|(version, directory)| (version, directory.join(&archive).join(name))),
            );
        }
        drivers.retain(|(_, path)| is_executable_file(path));
        drivers.sort_by(|left, right| right.0.cmp(&left.0));
        drivers
    }

    /// Chrome for Testing binaries in each of `caches`, in that order.
    pub(crate) fn find_all(&self, caches: &[ChromeForTestingCache]) -> Vec<PathBuf> {
        caches.iter().flat_map(|cache| self.find(*cache)).collect()
    }
}

/// The chromedriver Selenium Manager or `@puppeteer/browsers` downloaded for
/// the same Chrome for Testing release as `executable`, if any: chromedriver
/// only drives the Chrome version it was built for, and a `chromedriver` on
/// `PATH` belongs to the installed Google Chrome.
///
/// Selenium Manager keeps `<cache>/chrome/<platform>/<version>/chrome` next to
/// `<cache>/chromedriver/<platform>/<version>/chromedriver`; Puppeteer keeps
/// `<cache>/chrome/<platform>-<version>/…` next to
/// `<cache>/chromedriver/<platform>-<version>/chromedriver-<platform>/chromedriver`.
/// Playwright downloads no chromedriver.
pub(crate) fn matching_chromedriver(executable: &Path) -> Option<PathBuf> {
    if !is_chrome_for_testing(executable) {
        return None;
    }
    let name = if executable.extension().is_some_and(|ext| ext == "exe") {
        "chromedriver.exe"
    } else {
        "chromedriver"
    };
    let chrome = executable
        .parent()?
        .ancestors()
        .find(|ancestor| ancestor.file_name().is_some_and(|name| name == "chrome"))?;
    let mut release = executable.strip_prefix(chrome).ok()?.components();
    let first = release.next()?.as_os_str().to_owned();
    let drivers = chrome.parent()?.join("chromedriver").join(first);
    let selenium = release
        .next()
        .map(|version| drivers.join(version.as_os_str()).join(name));
    let puppeteer = std::fs::read_dir(&drivers)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("chromedriver-")
        })
        .map(|entry| entry.path().join(name));
    selenium
        .into_iter()
        .chain(puppeteer)
        .find(|path| is_executable_file(path))
}

/// The chromedriver that drives the Chrome for Testing `executable`: the one
/// of its own release, else the newest cached chromedriver of its major
/// version - chromedriver checks only that, as Selenium Manager does when it
/// pairs them. `major` reads the browser's major version and `locations`
/// are the caches searched.
pub(crate) fn chromedriver_for_with(
    executable: &Path,
    major: impl FnOnce(&Path) -> Option<u64>,
    locations: Option<&CacheLocations>,
) -> Option<PathBuf> {
    if let Some(driver) = matching_chromedriver(executable) {
        return Some(driver);
    }
    if !is_chrome_for_testing(executable) {
        return None;
    }
    let locations = locations?;
    let major = major(executable)?;
    locations
        .chromedrivers()
        .into_iter()
        .find(|(version, _)| version.first() == Some(&major))
        .map(|(_, driver)| driver)
}

/// [`chromedriver_for_with`] the caches of this machine.
pub(crate) fn chromedriver_for(executable: &Path) -> Option<PathBuf> {
    chromedriver_for_with(
        executable,
        browser_major_version,
        CacheLocations::from_environment().as_ref(),
    )
}

/// The major version of the Chrome at `executable`: on Windows from the
/// version directory next to `chrome.exe` (which prints no `--version`),
/// elsewhere from `--version` ("Google Chrome for Testing 131.0.6778.85").
fn browser_major_version(executable: &Path) -> Option<u64> {
    let major = |text: &str| text.split('.').next()?.parse::<u64>().ok();
    if cfg!(windows) {
        return versions(executable.parent()?, version_key)
            .into_iter()
            .find_map(|(version, _)| version.first().copied());
    }
    let output = crate::utilities::run_command_blocking(
        &executable.to_string_lossy(),
        &["--version"],
        crate::utilities::RunCommandOptions::default(),
    )
    .ok()?;
    major(output.stdout.split_whitespace().last()?)
}

/// The first of `candidates` that has the [`matching_chromedriver`] of its
/// release, else the first: fantoccini drives Chrome for Testing through
/// chromedriver.
pub(crate) fn prefer_driven(candidates: Vec<PathBuf>) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|candidate| matching_chromedriver(candidate).is_some())
        .or_else(|| candidates.first())
        .cloned()
}

/// A dotted version (`131.0.6778.204`) or revision (`1248`) as numbers, so
/// versions compare numerically.
fn version_key(text: &str) -> Option<Vec<u64>> {
    text.split('.')
        .map(|part| part.parse::<u64>().ok())
        .collect::<Option<Vec<_>>>()
}

/// The directories in `root` whose name `key` parses, with that version,
/// newest first.
fn versions(root: &Path, key: impl Fn(&str) -> Option<Vec<u64>>) -> Vec<(Vec<u64>, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut versions: Vec<(Vec<u64>, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let version = key(&entry.file_name().to_string_lossy())?;
            entry.path().is_dir().then(|| (version, entry.path()))
        })
        .collect();
    versions.sort_by(|left, right| right.0.cmp(&left.0));
    versions
}

/// The directories in `root` whose name `key` parses, newest first.
fn newest_first(root: &Path, key: impl Fn(&str) -> Option<Vec<u64>>) -> Vec<PathBuf> {
    versions(root, key)
        .into_iter()
        .map(|(_, path)| path)
        .collect()
}

#[cfg(test)]
#[path = "chrome_for_testing_tests.rs"]
mod tests;
