//! Which browser binary [`launch_browser`](super::launcher::launch_browser)
//! starts in its default real launch (issues #103 and #179).
//!
//! Mirrors `resolveLaunchExecutable` in `js/src/browser/launch-executable.js`.
//!
//! Without an explicit `channel` or `executable_path` the launch starts
//! Chrome for Testing - never the person's own Google Chrome - so an
//! automated run cannot touch the browser they use every day. Playwright and
//! Puppeteer report the browser they downloaded; chromiumoxide and fantoccini
//! look in the Playwright, Puppeteer and Selenium Manager caches. When no
//! Chrome for Testing is installed the launch fails and says how to install
//! one, or to pass channel `"chrome"` for the installed Google Chrome.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};

use crate::browser::chrome_for_testing::{
    is_executable_file, CacheLocations, ChromeForTestingCache,
};
use crate::browser::real_browser::{resolve_system_browser_executable, RealBrowserOptions};
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

const PLAYWRIGHT_INSTALL: &str = "`npx playwright install chromium`";
const PUPPETEER_INSTALL: &str = "`npx puppeteer browsers install chrome`";

/// The command that installs Chrome for Testing for `engine`.
fn install_command(engine: EngineType) -> String {
    match engine {
        EngineType::Playwright => PLAYWRIGHT_INSTALL.to_string(),
        EngineType::Puppeteer => PUPPETEER_INSTALL.to_string(),
        EngineType::Chromiumoxide | EngineType::Fantoccini => {
            format!("{PLAYWRIGHT_INSTALL} or {PUPPETEER_INSTALL}")
        }
    }
}

/// The error for a launch that found no Chrome for Testing.
pub(crate) fn chrome_for_testing_not_installed(engine: EngineType) -> anyhow::Error {
    anyhow!(
        "Chrome for Testing is not installed for {engine}: run {}, or pass channel \"chrome\" to start the installed Google Chrome",
        install_command(engine)
    )
}

/// Pick the browser binary for a real launch.
///
/// An explicit `executable_path` or `channel` (`explicit_selection`) is
/// resolved as given by `resolve_system`. Without either, the first existing
/// executable among the `chrome_for_testing` candidates is started; the
/// installed Google Chrome is never tried. Browser Commander spawns the
/// binary either way, with the same clean command line.
pub(crate) fn resolve_launch_executable(
    options: &RealBrowserOptions,
    explicit_selection: bool,
    resolve_system: impl FnOnce(&RealBrowserOptions) -> Result<PathBuf>,
    chrome_for_testing: impl FnOnce(&RealBrowserOptions) -> Vec<PathBuf>,
) -> Result<PathBuf> {
    if explicit_selection {
        return resolve_system(options);
    }
    chrome_for_testing(options)
        .into_iter()
        .find(|path| is_executable_file(path))
        .ok_or_else(|| chrome_for_testing_not_installed(options.engine))
}

/// The caches each engine finds Chrome for Testing in, in order.
fn engine_caches(engine: EngineType) -> &'static [ChromeForTestingCache] {
    match engine {
        EngineType::Playwright => &[ChromeForTestingCache::Playwright],
        EngineType::Puppeteer => &[ChromeForTestingCache::Puppeteer],
        EngineType::Chromiumoxide | EngineType::Fantoccini => &[
            ChromeForTestingCache::Playwright,
            ChromeForTestingCache::Puppeteer,
            ChromeForTestingCache::Selenium,
        ],
    }
}

/// Chrome for Testing in the download caches `engine` uses, newest first.
pub(crate) fn cached_chrome_for_testing(engine: EngineType) -> Vec<PathBuf> {
    CacheLocations::from_environment()
        .map(|locations| locations.find_all(engine_caches(engine)))
        .unwrap_or_default()
}

/// The Chrome for Testing candidates for a launch without a selection: the
/// browser a Node engine downloaded, then the download caches.
fn chrome_for_testing_candidates(options: &RealBrowserOptions) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if matches!(
        options.engine,
        EngineType::Playwright | EngineType::Puppeteer
    ) {
        candidates.extend(node_bundled_executable(
            options.engine,
            options.node_executable.as_deref(),
            options.node_working_dir.as_deref(),
        ));
    }
    candidates.extend(cached_chrome_for_testing(options.engine));
    candidates
}

/// The browser a Node engine downloaded, as the engine reports it.
pub(crate) fn node_bundled_executable(
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

/// The browser [`launch_browser`](super::launcher::launch_browser) and
/// [`launch_real_browser`](super::real_browser::launch_real_browser) start:
/// the named channel or executable, otherwise Chrome for Testing.
pub(crate) fn resolve_default_launch_executable(options: &RealBrowserOptions) -> Result<PathBuf> {
    resolve_launch_executable(
        options,
        options.channel.is_some() || options.executable_path.is_some(),
        resolve_system_browser_executable,
        chrome_for_testing_candidates,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn existing_file() -> PathBuf {
        std::env::current_exe().expect("test binary path")
    }

    #[test]
    fn chrome_for_testing_is_started_without_a_selection() {
        let bundled = existing_file();
        let resolved = resolve_launch_executable(
            &RealBrowserOptions::playwright(),
            false,
            |_| panic!("the installed Google Chrome is never tried without a selection"),
            |_| vec![bundled.clone()],
        )
        .unwrap();
        assert_eq!(resolved, bundled);
    }

    #[test]
    fn a_missing_candidate_is_skipped() {
        let bundled = existing_file();
        let resolved = resolve_launch_executable(
            &RealBrowserOptions::chromiumoxide(),
            false,
            |_| panic!("the installed Google Chrome is never tried without a selection"),
            |_| {
                vec![
                    PathBuf::from("/nonexistent/browser-commander/chrome"),
                    bundled.clone(),
                ]
            },
        )
        .unwrap();
        assert_eq!(resolved, bundled);
    }

    #[test]
    fn an_explicit_channel_resolves_the_installed_browser() {
        let chrome = PathBuf::from("/opt/google/chrome/chrome");
        let resolved = resolve_launch_executable(
            &RealBrowserOptions::playwright().channel("chrome"),
            true,
            |options| {
                assert_eq!(options.channel.as_deref(), Some("chrome"));
                Ok(chrome.clone())
            },
            |_| panic!("an explicit selection is never replaced by Chrome for Testing"),
        )
        .unwrap();
        assert_eq!(resolved, chrome);
    }

    #[test]
    fn an_explicit_selection_is_never_replaced() {
        let error = resolve_launch_executable(
            &RealBrowserOptions::playwright().channel("msedge"),
            true,
            |_| Err(anyhow!("no Edge installed")),
            |_| vec![existing_file()],
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "no Edge installed");
    }

    #[test]
    fn no_chrome_for_testing_names_the_install_command_and_the_chrome_channel() {
        for (options, install) in [
            (
                RealBrowserOptions::playwright(),
                "npx playwright install chromium",
            ),
            (
                RealBrowserOptions::puppeteer(),
                "npx puppeteer browsers install chrome",
            ),
            (
                RealBrowserOptions::chromiumoxide(),
                "npx playwright install chromium",
            ),
        ] {
            let error = resolve_launch_executable(
                &options,
                false,
                |_| Ok(PathBuf::from("/usr/bin/google-chrome")),
                |_| vec![PathBuf::from("/nonexistent/browser-commander/chrome")],
            )
            .unwrap_err()
            .to_string();
            assert!(
                error.starts_with(&format!(
                    "Chrome for Testing is not installed for {}",
                    options.engine
                )),
                "{error}"
            );
            assert!(error.contains(install), "{error}");
            assert!(error.contains("channel \"chrome\""), "{error}");
        }
    }

    #[test]
    fn a_missing_node_has_no_engine_browser() {
        assert_eq!(
            node_bundled_executable(
                EngineType::Playwright,
                Some(Path::new("browser-commander-missing-node")),
                None,
            ),
            None
        );
    }
}
