//! Which browser binary [`launch_browser`](super::launcher::launch_browser)
//! starts in its default real launch (issue #103).
//!
//! Mirrors `resolveLaunchExecutable` in `js/src/browser/launcher.js`.

use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::browser::real_browser::{
    resolve_system_browser_executable, LaunchHooks, RealBrowserOptions,
};
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

/// Pick the browser binary for a real launch.
///
/// An explicit `executable_path` or `channel` (`explicit_selection`) is
/// honoured as given. Without either, the installed Google Chrome is
/// preferred - it is the browser a person would start - and the engine's own
/// browser is the fallback, so a machine with only `npx playwright install`
/// still works. Browser Commander spawns the binary either way, with the same
/// clean command line.
pub(crate) fn resolve_launch_executable(
    options: &RealBrowserOptions,
    explicit_selection: bool,
    resolve_system: impl FnOnce(&RealBrowserOptions) -> Result<PathBuf>,
    bundled: impl FnOnce(&RealBrowserOptions) -> Option<PathBuf>,
) -> Result<PathBuf> {
    match resolve_system(options) {
        Ok(executable) => Ok(executable),
        Err(error) if explicit_selection => Err(error),
        Err(error) => bundled(options).filter(|path| path.is_file()).ok_or(error),
    }
}

/// The browser the engine itself would have launched.
fn bundled_engine_executable(options: &RealBrowserOptions) -> Option<PathBuf> {
    match options.engine {
        EngineType::Chromiumoxide => chromiumoxide::detection::default_executable(
            chromiumoxide::detection::DetectionOptions::default(),
        )
        .ok(),
        EngineType::Playwright | EngineType::Puppeteer => node_bundled_executable(
            options.engine,
            options.node_executable.as_deref(),
            options.node_working_dir.as_deref(),
        ),
        EngineType::Fantoccini => None,
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

/// Launch hooks for [`launch_browser`](super::launcher::launch_browser): the
/// system side effects, with the engine's browser as the executable fallback.
pub(crate) struct DefaultLaunchHooks {
    /// Whether the caller named a channel or an executable.
    pub(crate) explicit_selection: bool,
}

impl LaunchHooks for DefaultLaunchHooks {
    fn resolve_executable(&self, options: &RealBrowserOptions) -> Result<PathBuf> {
        resolve_launch_executable(
            options,
            self.explicit_selection,
            resolve_system_browser_executable,
            bundled_engine_executable,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;

    fn existing_file() -> PathBuf {
        std::env::current_exe().expect("test binary path")
    }

    #[test]
    fn the_installed_chrome_wins() {
        let chrome = PathBuf::from("/opt/google/chrome/chrome");
        let resolved = resolve_launch_executable(
            &RealBrowserOptions::playwright(),
            false,
            |_| Ok(chrome.clone()),
            |_| panic!("the engine's browser is only a fallback"),
        )
        .unwrap();
        assert_eq!(resolved, chrome);
    }

    #[test]
    fn the_engine_browser_is_the_fallback_without_a_selection() {
        let bundled = existing_file();
        let resolved = resolve_launch_executable(
            &RealBrowserOptions::playwright(),
            false,
            |_| Err(anyhow!("no Chrome installed")),
            |_| Some(bundled.clone()),
        )
        .unwrap();
        assert_eq!(resolved, bundled);
    }

    #[test]
    fn an_explicit_selection_is_never_replaced() {
        let error = resolve_launch_executable(
            &RealBrowserOptions::playwright().channel("msedge"),
            true,
            |_| Err(anyhow!("no Edge installed")),
            |_| Some(existing_file()),
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "no Edge installed");
    }

    #[test]
    fn a_missing_engine_browser_keeps_the_original_error() {
        let error = resolve_launch_executable(
            &RealBrowserOptions::puppeteer(),
            false,
            |_| Err(anyhow!("no Chrome installed")),
            |_| Some(PathBuf::from("/nonexistent/browser-commander/chrome")),
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "no Chrome installed");
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
