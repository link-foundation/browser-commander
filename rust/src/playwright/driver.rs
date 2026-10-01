//! Locating and starting the official Playwright driver.
//!
//! Every non-JavaScript Playwright binding talks to the same process:
//! `playwright-core`'s `cli.js run-driver`, which speaks the protocol in
//! [`crate::playwright::protocol`] over its stdin and stdout. The driver is
//! started through command-stream, like the other long-running processes the
//! Rust crate owns.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use command_stream::{quote::quote, ProcessRunner, RunOptions, StdinOption};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

use super::connection::{Connection, ProtocolError};
use super::protocol::{Playwright, PROTOCOL_VERSION};
use crate::utilities::subprocess::kill_owned_process_tree;

/// Environment variable naming the driver: `playwright-core`'s `cli.js`, or
/// the `playwright-core` package directory.
pub const DRIVER_ENV: &str = "BROWSER_COMMANDER_PLAYWRIGHT_DRIVER";

const STDERR_LINES: usize = 200;
const EXIT_GRACE: Duration = Duration::from_secs(5);

/// Where a usable driver lives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DriverLocation {
    /// `playwright-core/cli.js`.
    pub cli: PathBuf,
    /// The `playwright-core` version found next to it.
    pub version: String,
}

impl DriverLocation {
    /// Find a driver whose protocol matches the generated bindings.
    ///
    /// Looks at [`DRIVER_ENV`], then `node_modules/playwright-core` (directly
    /// or under `playwright`) in `working_dir` and its ancestors, then the
    /// npm package checked out next to this crate.
    pub fn resolve(working_dir: Option<&Path>) -> Result<Self, ProtocolError> {
        if let Some(configured) = std::env::var_os(DRIVER_ENV) {
            let configured = PathBuf::from(configured);
            let cli = if configured.is_dir() {
                configured.join("cli.js")
            } else {
                configured
            };
            return Self::at(&cli);
        }

        let start = working_dir
            .map(Path::to_path_buf)
            .or_else(|| std::env::current_dir().ok());
        let mut candidates = Vec::new();
        if let Some(start) = start {
            for directory in start.ancestors() {
                let modules = directory.join("node_modules");
                candidates.push(modules.join("playwright-core/cli.js"));
                candidates.push(modules.join("playwright/node_modules/playwright-core/cli.js"));
            }
        }
        candidates.push(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../js/node_modules/playwright-core/cli.js"),
        );

        let mut mismatches = Vec::new();
        for cli in candidates.iter().filter(|cli| cli.is_file()) {
            match Self::at(cli) {
                Ok(location) => return Ok(location),
                Err(err) => mismatches.push(err.to_string()),
            }
        }
        Err(ProtocolError::Driver(if mismatches.is_empty() {
            format!(
                "playwright-core was not found; install it with npm or set {DRIVER_ENV} to its cli.js"
            )
        } else {
            mismatches.join("; ")
        }))
    }

    /// Check one `cli.js`: it must exist and belong to a `playwright-core`
    /// release with the same major.minor version as [`PROTOCOL_VERSION`].
    pub fn at(cli: &Path) -> Result<Self, ProtocolError> {
        if !cli.is_file() {
            return Err(ProtocolError::Driver(format!(
                "{} does not exist",
                cli.display()
            )));
        }
        let manifest = cli.with_file_name("package.json");
        let version = std::fs::read_to_string(&manifest)
            .ok()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
            .and_then(|json| json["version"].as_str().map(str::to_owned))
            .ok_or_else(|| {
                ProtocolError::Driver(format!("cannot read the version in {}", manifest.display()))
            })?;
        if !same_minor(&version, PROTOCOL_VERSION) {
            return Err(ProtocolError::Driver(format!(
                "{} is playwright-core {version}, but the bindings were generated for {PROTOCOL_VERSION}",
                cli.display()
            )));
        }
        Ok(Self {
            cli: cli.to_path_buf(),
            version,
        })
    }
}

fn same_minor(left: &str, right: &str) -> bool {
    let minor = |version: &str| version.split('.').take(2).collect::<Vec<_>>().join(".");
    minor(left) == minor(right)
}

/// Options for starting a driver.
#[derive(Debug, Clone, Default)]
pub struct DriverOptions {
    /// Node.js executable. Defaults to `BROWSER_COMMANDER_NODE`, then `node`.
    pub node: Option<PathBuf>,
    /// Working directory, also the first place searched for `playwright-core`.
    pub working_dir: Option<PathBuf>,
    /// Echo the driver's stderr as it arrives.
    pub verbose: bool,
}

/// A running `playwright run-driver` process and its connection.
pub struct PlaywrightDriver {
    connection: Connection,
    playwright: Playwright,
    location: DriverLocation,
    runner: Mutex<Option<ProcessRunner>>,
    pid: Option<u32>,
    stderr: Arc<StdMutex<VecDeque<String>>>,
}

impl std::fmt::Debug for PlaywrightDriver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PlaywrightDriver")
            .field("location", &self.location)
            .field("pid", &self.pid)
            .finish()
    }
}

impl PlaywrightDriver {
    /// Find the driver, start it and run the `initialize` handshake.
    pub async fn launch(options: DriverOptions) -> Result<Self, ProtocolError> {
        let location = DriverLocation::resolve(options.working_dir.as_deref())?;
        Self::launch_at(location, options).await
    }

    /// Start a driver that has already been located.
    pub async fn launch_at(
        location: DriverLocation,
        options: DriverOptions,
    ) -> Result<Self, ProtocolError> {
        let node = options
            .node
            .clone()
            .or_else(|| std::env::var_os("BROWSER_COMMANDER_NODE").map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("node"));
        let node = node.to_string_lossy().into_owned();
        let cli = location.cli.to_string_lossy().into_owned();
        let command = [node.as_str(), cli.as_str(), "run-driver"]
            .into_iter()
            .map(quote)
            .collect::<Vec<_>>()
            .join(" ");

        let mut runner = ProcessRunner::new(
            command,
            RunOptions {
                mirror: false,
                capture: true,
                stdin: StdinOption::Pipe,
                cwd: options.working_dir.clone(),
                shell_operators: false,
                trace: false,
                ..RunOptions::default()
            },
        );
        runner
            .start()
            .await
            .map_err(|err| ProtocolError::Driver(format!("failed to start {node}: {err}")))?;
        let pid = runner.pid();
        let (stdin, stdout, stderr) = {
            let mut child = runner.child().ok_or_else(|| {
                ProtocolError::Driver("the driver process did not start".to_string())
            })?;
            let native = child.native_mut();
            (
                native.stdin.take(),
                native.stdout.take(),
                native.stderr.take(),
            )
        };
        let (Some(stdin), Some(stdout)) = (stdin, stdout) else {
            if let Some(pid) = pid {
                kill_owned_process_tree(pid);
            }
            return Err(ProtocolError::Driver(
                "the driver's stdin and stdout were not piped".to_string(),
            ));
        };

        let stderr_lines = Arc::new(StdMutex::new(VecDeque::new()));
        if let Some(stderr) = stderr {
            let lines = Arc::clone(&stderr_lines);
            let verbose = options.verbose;
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    if verbose {
                        eprintln!("[playwright driver] {line}");
                    }
                    tracing::debug!(target: "browser_commander::playwright_driver", "{line}");
                    if let Ok(mut lines) = lines.lock() {
                        if lines.len() == STDERR_LINES {
                            lines.pop_front();
                        }
                        lines.push_back(line);
                    }
                }
            });
        }

        let connection = Connection::new(stdout, stdin);
        let playwright = match connection.initialize().await {
            Ok(playwright) => playwright,
            Err(err) => {
                if let Some(pid) = pid {
                    kill_owned_process_tree(pid);
                }
                let log = stderr_lines
                    .lock()
                    .map(|lines| lines.iter().cloned().collect::<Vec<_>>().join("\n"))
                    .unwrap_or_default();
                return Err(ProtocolError::Driver(format!(
                    "the driver did not initialize: {err}{}",
                    if log.is_empty() {
                        String::new()
                    } else {
                        format!("\n{log}")
                    }
                )));
            }
        };

        Ok(Self {
            connection,
            playwright,
            location,
            runner: Mutex::new(Some(runner)),
            pid,
            stderr: stderr_lines,
        })
    }

    /// The protocol connection.
    pub fn connection(&self) -> &Connection {
        &self.connection
    }

    /// The `Playwright` root object (browser types, selectors, devices…).
    pub fn playwright(&self) -> &Playwright {
        &self.playwright
    }

    /// The driver that was started.
    pub fn location(&self) -> &DriverLocation {
        &self.location
    }

    /// Process id of the driver.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// The driver's most recent stderr lines.
    pub fn stderr_tail(&self) -> Vec<String> {
        self.stderr
            .lock()
            .map(|lines| lines.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Stop the driver: end its input, give it time to exit (it closes the
    /// browsers it launched), then kill whatever is left of its process tree.
    pub async fn close(&self) {
        self.connection.close_input().await;
        let Some(mut runner) = self.runner.lock().await.take() else {
            return;
        };
        let deadline = tokio::time::Instant::now() + EXIT_GRACE;
        loop {
            let exited = runner
                .child()
                .map(|mut child| matches!(child.native_mut().try_wait(), Ok(Some(_))))
                .unwrap_or(true);
            if exited || tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        if let Some(pid) = self.pid {
            kill_owned_process_tree(pid);
        }
    }
}

impl Drop for PlaywrightDriver {
    fn drop(&mut self) {
        let still_owned = self
            .runner
            .try_lock()
            .map(|runner| runner.is_some())
            .unwrap_or(true);
        if still_owned {
            if let Some(pid) = self.pid {
                kill_owned_process_tree(pid);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_match_on_major_and_minor() {
        assert!(same_minor("1.62.1", "1.62.0"));
        assert!(same_minor("1.62.1-beta", "1.62.1"));
        assert!(!same_minor("1.61.9", "1.62.1"));
    }

    #[test]
    fn a_driver_with_another_protocol_version_is_rejected() {
        let directory = std::env::temp_dir().join(format!(
            "browser-commander-driver-version-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let cli = directory.join("cli.js");
        std::fs::write(&cli, "").unwrap();
        std::fs::write(
            directory.join("package.json"),
            r#"{"name":"playwright-core","version":"0.1.0"}"#,
        )
        .unwrap();
        let error = DriverLocation::at(&cli).unwrap_err().to_string();
        assert!(error.contains("0.1.0"), "{error}");

        std::fs::write(
            directory.join("package.json"),
            format!(r#"{{"name":"playwright-core","version":"{PROTOCOL_VERSION}"}}"#),
        )
        .unwrap();
        assert_eq!(DriverLocation::at(&cli).unwrap().version, PROTOCOL_VERSION);
        let _ = std::fs::remove_dir_all(&directory);
    }
}
