//! Which browser binary a launch starts (issues #103 and #179).
//!
//! Without `channel` or `executable_path` a launch starts Chrome for Testing,
//! the browser Playwright and Puppeteer download. It is an application of its
//! own (`com.google.chrome.for.testing` on macOS), so nothing of the user's
//! Google Chrome (its Dock icon, its new tabs, the links other apps open) goes
//! to the automation window. The installed Google Chrome is used only on
//! request.
//!
//! Mirrors `js/src/browser/launch-executable.js`.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};

use crate::browser::real_browser::{resolve_system_browser_executable, RealBrowserOptions};
use crate::browser::restrictions::launch_restriction_preset;
use crate::core::engine::EngineType;
use crate::utilities::{run_command_blocking, RunCommandOptions};

/// Prints the path of the Chromium the Node engine downloaded.
const NODE_BUNDLED_EXECUTABLE_SCRIPT: &str = r#"
const engine = process.argv[1];
const module = engine === "playwright"
  ? (await import("playwright")).chromium
  : (await import("puppeteer")).default;
process.stdout.write(module.executablePath());
"#;

/// The launch restriction preset every Chrome for Testing launch gets by
/// default: `no-chrome-for-testing-infobar` (`--test-type=gpu`) and
/// `mock-keychain` (`--use-mock-keychain`).
pub const CHROME_FOR_TESTING_PRESET: &str = "chrome-for-testing";

// Chrome for Testing archives unpack to chrome-<platform>; the macOS app is
// "Google Chrome for Testing.app". Playwright's older own Chromium builds
// (chrome-linux, chrome-win, Chromium.app) are not Chrome for Testing.
const CHROME_FOR_TESTING_DIRECTORIES: [&str; 5] = [
    "chrome-linux64",
    "chrome-win64",
    "chrome-win32",
    "chrome-mac-x64",
    "chrome-mac-arm64",
];
const SELENIUM_CACHE_PLATFORMS: [&str; 5] = ["linux64", "win64", "win32", "mac-x64", "mac-arm64"];
const MAC_EXECUTABLE: &str =
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

/// The restrictions every Chrome for Testing launch gets by default.
pub fn chrome_for_testing_restrictions() -> &'static [String] {
    launch_restriction_preset(CHROME_FOR_TESTING_PRESET)
        .expect("launch-restrictions.json defines the chrome-for-testing preset")
}

/// Whether an executable is a Chrome for Testing build, judged by its install
/// path: Playwright, Puppeteer, `@puppeteer/browsers` and Selenium Manager all
/// keep it under a Chrome for Testing archive directory.
pub fn is_chrome_for_testing(executable_path: impl AsRef<Path>) -> bool {
    let lowered = executable_path.as_ref().to_string_lossy().to_lowercase();
    let segments: Vec<&str> = lowered
        .split(['/', '\\'])
        .filter(|segment| !segment.is_empty())
        .collect();
    if segments.iter().any(|segment| {
        segment.contains("chrome for testing") || CHROME_FOR_TESTING_DIRECTORIES.contains(segment)
    }) {
        return true;
    }
    // Selenium Manager: ~/.cache/selenium/chrome/<platform>/<version>/chrome
    segments
        .iter()
        .rposition(|segment| *segment == "selenium")
        .is_some_and(|selenium| {
            segments.get(selenium + 1) == Some(&"chrome")
                && segments
                    .get(selenium + 2)
                    .is_some_and(|platform| SELENIUM_CACHE_PLATFORMS.contains(platform))
        })
}

/// The restrictions a launch of `executable_path` gets unless the caller sets
/// `default_restrictions` (`requested`): the `chrome-for-testing` preset for
/// Chrome for Testing, nothing for any other browser.
pub fn default_restrictions_for(
    executable_path: impl AsRef<Path>,
    requested: Option<&[String]>,
) -> Vec<String> {
    match requested {
        Some(requested) => requested.to_vec(),
        None if is_chrome_for_testing(executable_path) => {
            chrome_for_testing_restrictions().to_vec()
        }
        None => Vec::new(),
    }
}

/// Pick the browser binary for a launch.
///
/// An explicit `executable_path` or `channel` is honoured as given. Without
/// either, the engine's downloaded Chrome for Testing is started. The
/// installed Google Chrome is never a silent fallback: without Chrome for
/// Testing the launch fails and says how to install it or how to ask for
/// Google Chrome.
pub fn resolve_launch_executable(options: &RealBrowserOptions) -> Result<PathBuf> {
    resolve_launch_executable_with(
        options,
        resolve_system_browser_executable,
        bundled_engine_executable,
    )
}

pub(crate) fn resolve_launch_executable_with(
    options: &RealBrowserOptions,
    resolve_system: impl FnOnce(&RealBrowserOptions) -> Result<PathBuf>,
    bundled: impl FnOnce(&RealBrowserOptions) -> Option<PathBuf>,
) -> Result<PathBuf> {
    if options.channel.is_some() || options.executable_path.is_some() {
        return resolve_system(options);
    }
    bundled(options)
        .filter(|path| is_executable(path))
        .ok_or_else(|| not_installed(options.engine))
}

fn not_installed(engine: EngineType) -> anyhow::Error {
    let install = match engine {
        EngineType::Playwright => "`npx playwright install chromium`",
        EngineType::Puppeteer => "`npx puppeteer browsers install chrome`",
        EngineType::Chromiumoxide | EngineType::Fantoccini => {
            "`npx playwright install chromium` or `npx @puppeteer/browsers install chrome@stable`"
        }
    };
    anyhow!(
        "Chrome for Testing is not installed for {engine}: run {install}, or select channel(\"chrome\") to start the installed Google Chrome"
    )
}

/// The Chrome for Testing the engine would launch: the one Playwright or
/// Puppeteer reports, else the newest one in the download caches.
/// Chromiumoxide and fantoccini download nothing themselves, so they use the
/// Playwright, Puppeteer or Selenium Manager download; fantoccini looks first
/// where a matching chromedriver is downloaded too.
pub(crate) fn bundled_engine_executable(options: &RealBrowserOptions) -> Option<PathBuf> {
    let caches = DownloadCaches::from_environment();
    match options.engine {
        EngineType::Playwright | EngineType::Puppeteer => node_bundled_executable(
            options.engine,
            options.node_executable.as_deref(),
            options.node_working_dir.as_deref(),
        )
        .filter(|path| is_executable(path))
        .or_else(|| {
            let source = if options.engine == EngineType::Playwright {
                CacheSource::Playwright
            } else {
                CacheSource::Puppeteer
            };
            caches.find(&[source], std::env::consts::OS)
        }),
        EngineType::Chromiumoxide => caches.find(
            &[
                CacheSource::Playwright,
                CacheSource::Puppeteer,
                CacheSource::Selenium,
            ],
            std::env::consts::OS,
        ),
        EngineType::Fantoccini => caches.find_driven(
            &[
                CacheSource::Selenium,
                CacheSource::Puppeteer,
                CacheSource::Playwright,
            ],
            std::env::consts::OS,
        ),
    }
}

/// A tool that downloads Chrome for Testing into a cache of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CacheSource {
    Playwright,
    Puppeteer,
    Selenium,
}

/// Where Playwright, Puppeteer and Selenium Manager keep their downloads.
#[derive(Debug, Clone, Default)]
pub(crate) struct DownloadCaches {
    pub(crate) playwright: Option<PathBuf>,
    pub(crate) puppeteer: Option<PathBuf>,
    pub(crate) selenium: Option<PathBuf>,
}

impl DownloadCaches {
    fn from_environment() -> Self {
        let home = dirs::home_dir();
        let variable = |name: &str| {
            std::env::var_os(name)
                .filter(|value| !value.is_empty() && value != "0")
                .map(PathBuf::from)
        };
        Self {
            playwright: variable("PLAYWRIGHT_BROWSERS_PATH")
                .or_else(|| dirs::cache_dir().map(|cache| cache.join("ms-playwright"))),
            puppeteer: variable("PUPPETEER_CACHE_DIR")
                .or_else(|| home.as_ref().map(|home| home.join(".cache/puppeteer"))),
            selenium: variable("SE_CACHE_PATH")
                .or_else(|| home.as_ref().map(|home| home.join(".cache/selenium"))),
        }
    }

    /// The newest Chrome for Testing in the caches of `sources`, in order.
    pub(crate) fn find(&self, sources: &[CacheSource], os: &str) -> Option<PathBuf> {
        let (directories, executable): (&[&str], &str) = match os {
            "macos" => (&["chrome-mac-arm64", "chrome-mac-x64"], MAC_EXECUTABLE),
            "windows" => (&["chrome-win64", "chrome-win32"], "chrome.exe"),
            _ => (&["chrome-linux64"], "chrome"),
        };
        let in_archive = |version: &Path| {
            directories
                .iter()
                .map(|directory| version.join(directory).join(executable))
                .find(|path| is_executable(path))
        };
        sources.iter().find_map(|source| match source {
            // <cache>/chromium-<revision>/chrome-<platform>/<executable>
            CacheSource::Playwright => newest(self.playwright.as_deref()?, |name| {
                name.starts_with("chromium-")
            })
            .find_map(|version| in_archive(&version)),
            // <cache>/chrome/<platform>-<version>/chrome-<platform>/<executable>
            CacheSource::Puppeteer => newest(&self.puppeteer.as_deref()?.join("chrome"), |_| true)
                .find_map(|version| in_archive(&version)),
            // <cache>/chrome/<platform>/<version>/<executable>
            CacheSource::Selenium => {
                let chrome = self.selenium.as_deref()?.join("chrome");
                directories.iter().find_map(|directory| {
                    let platform = directory.trim_start_matches("chrome-");
                    newest(&chrome.join(platform), |_| true)
                        .map(|version| version.join(executable))
                        .find(|path| is_executable(path))
                })
            }
        })
    }
}

impl DownloadCaches {
    /// The first download in `sources` that has the [`matching_chromedriver`]
    /// of its release, else the first download: a chromedriver on PATH
    /// belongs to the installed Google Chrome and refuses another release.
    pub(crate) fn find_driven(&self, sources: &[CacheSource], os: &str) -> Option<PathBuf> {
        sources
            .iter()
            .filter_map(|source| self.find(std::slice::from_ref(source), os))
            .find(|executable| matching_chromedriver(executable).is_some())
            .or_else(|| self.find(sources, os))
    }
}

/// The chromedriver Selenium Manager or `@puppeteer/browsers` downloaded for
/// the same Chrome for Testing release as `executable`, if any: chromedriver
/// only drives the Chrome version it was built for.
///
/// Selenium Manager keeps `<cache>/chrome/<platform>/<version>/chrome` next to
/// `<cache>/chromedriver/<platform>/<version>/chromedriver`; Puppeteer keeps
/// `<cache>/chrome/<platform>-<version>/…` next to
/// `<cache>/chromedriver/<platform>-<version>/chromedriver-<platform>/chromedriver`.
pub(crate) fn matching_chromedriver(executable: &Path) -> Option<PathBuf> {
    let name = if executable.extension().is_some_and(|ext| ext == "exe") {
        "chromedriver.exe"
    } else {
        "chromedriver"
    };
    let chrome = executable
        .parent()?
        .ancestors()
        .find(|ancestor| ancestor.file_name().is_some_and(|name| name == "chrome"))?;
    let release = executable.strip_prefix(chrome).ok()?;
    let mut components = release.components();
    let first = components.next()?.as_os_str().to_owned();
    let drivers = chrome.parent()?.join("chromedriver");
    let selenium = components
        .next()
        .map(|version| drivers.join(&first).join(version.as_os_str()).join(name));
    let puppeteer = std::fs::read_dir(drivers.join(&first))
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
        .find(|path| is_executable(path))
}

/// The subdirectories of `directory` whose name `matches`, newest version
/// first.
fn newest(directory: &Path, matches: impl Fn(&str) -> bool) -> impl Iterator<Item = PathBuf> {
    let mut versions: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(directory)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            matches(&name).then(|| (version_key(&name), entry.path()))
        })
        .collect();
    versions.sort_by(|left, right| right.cmp(left));
    versions.into_iter().map(|(_, path)| path)
}

fn version_key(name: &str) -> Vec<u64> {
    name.split(|character: char| !character.is_ascii_digit())
        .filter_map(|number| number.parse().ok())
        .collect()
}

fn is_executable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        metadata.is_file()
    }
}

fn node_bundled_executable(
    engine: EngineType,
    node_executable: Option<&Path>,
    node_working_dir: Option<&Path>,
) -> Option<PathBuf> {
    let node = node_executable
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "node".to_string());
    let output = run_command_blocking(
        &node,
        &[
            "--input-type=module",
            "-e",
            NODE_BUNDLED_EXECUTABLE_SCRIPT,
            &engine.to_string(),
        ],
        RunCommandOptions {
            cwd: node_working_dir.map(Path::to_path_buf),
            ..RunCommandOptions::default()
        },
    )
    .ok()?;
    let path = output.stdout.trim();
    (!path.is_empty()).then(|| PathBuf::from(path))
}

#[cfg(test)]
#[path = "launch_executable_tests.rs"]
mod tests;
