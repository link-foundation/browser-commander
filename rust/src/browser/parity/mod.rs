//! Measure driven browsers against the same binary started by hand.
//!
//! The environment reference is a plain command-stream child with no CDP
//! endpoint. Both reference and candidate load the same loopback probe page
//! and POST their reports. A separate reference launch reads `chrome://version`
//! with a fixed debugging port to capture switches Chrome appends itself.

mod comparison;
mod reference;
mod server;

use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::launch_executable::DefaultLaunchHooks;
use super::real_browser::LaunchHooks;
use super::{launch_browser, LaunchOptions, LaunchResult};
use crate::core::{EngineAdapter, EngineType};

use comparison::command_line_differences;
pub use comparison::{
    classify_differences, compare_command_lines, diff_reports, parse_switch_args, parse_switches,
    ChangedSwitch, CommandLineComparison, FeatureComparison, ParityContext, ParityDifference,
    ProbeDifference,
};
pub use reference::build_reference_args;
use server::ProbeServer;

/// Canonical environment probe, embedded so crates.io installs need no npm package.
pub const PROBE_SOURCE: &str = include_str!("probe.js");

pub(crate) const VERSION_EXPRESSION: &str = r#"(() => {
  const text = id => (document.getElementById(id)?.textContent ?? '').trim();
  if (!text('command_line')) return null;
  return { commandLine:text('command_line'), version:text('version'), executablePath:text('executable_path') };
})()"#;

/// Options for native browser parity measurement.
#[derive(Debug, Clone)]
pub struct MeasureParityOptions {
    /// Candidate launch options, including engine, launch mode and requested restrictions.
    pub launch: LaunchOptions,
    /// Whether a borrowed session was started by somebody else.
    pub attached: bool,
    /// Maximum duration of each capture; defaults to sixty seconds.
    pub timeout: Duration,
    /// Extra arguments for both reference launches. Empty preserves a hand-started baseline.
    /// Container callers can explicitly supply `--no-sandbox` here.
    pub reference_args: Vec<String>,
}

impl Default for MeasureParityOptions {
    fn default() -> Self {
        Self {
            launch: LaunchOptions::default(),
            attached: false,
            timeout: Duration::from_secs(60),
            reference_args: Vec::new(),
        }
    }
}

/// Browser metadata in the portable parity report.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParityBrowser {
    /// Binary used for both captures.
    pub executable_path: String,
    /// Version Chrome reports.
    pub version: String,
    /// Candidate engine.
    pub engine: EngineType,
    /// `real` or `engine` launch.
    pub launch: String,
    /// Whether the browser ran headlessly.
    pub headless: bool,
}

/// Browser-reported command lines and their comparison.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParityCommandLine {
    /// Candidate's `chrome://version` command line.
    pub launched: String,
    /// Reference's `chrome://version` command line.
    pub reference: String,
    /// Switch comparison fields, flattened to the shared schema.
    #[serde(flatten)]
    pub comparison: CommandLineComparison,
}

/// Typed report serialized identically to JavaScript/Python `measureParity`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParityReport {
    /// Browser and launch metadata.
    pub browser: ParityBrowser,
    /// Chrome's actual command lines, including its own appended switches.
    pub command_line: ParityCommandLine,
    /// Every measured difference, with explanations where available.
    pub differences: Vec<ParityDifference>,
    /// Differences not explained by a requested option or shared limitation.
    pub unlisted: Vec<ParityDifference>,
    /// True only when `unlisted` is empty.
    pub ok: bool,
}

async fn capture_candidate(
    session: &LaunchResult,
    server: &ProbeServer,
    timeout: Duration,
) -> Result<(Value, Value)> {
    tokio::time::timeout(timeout, session.page.goto(&server.candidate_url)).await??;
    let report = server.report(false, timeout).await?;
    let version = tokio::time::timeout(timeout, session.page.read_browser_version_page()).await??;
    Ok((report, version))
}

fn assemble_report(
    session: &LaunchResult,
    options: &MeasureParityOptions,
    executable: &Path,
    reference: Value,
    reference_version: Value,
    candidate: Value,
    candidate_version: Value,
) -> Result<ParityReport> {
    let command = |value: &Value| {
        value
            .get("commandLine")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .context("chrome://version did not report its command line")
    };
    let launched = command(&candidate_version)?;
    let reference_command = command(&reference_version)?;
    let comparison = compare_command_lines(&reference_command, &launched);
    let mut raw_differences = command_line_differences(&comparison);
    raw_differences.extend(diff_reports(&reference, &candidate));
    let mut requested_args = options.launch.args.clone();
    requested_args.extend(options.launch.extra_args.clone());
    if !options.launch.sandbox {
        requested_args.push("--no-sandbox".into());
    }
    if !options.launch.restrictions.is_empty() {
        requested_args.extend(
            session
                .args
                .iter()
                .filter(|arg| {
                    !arg.starts_with("--user-data-dir")
                        && !arg.starts_with("--remote-debugging-port")
                })
                .cloned(),
        );
    }
    let launch = session
        .launch
        .unwrap_or(options.launch.launch)
        .as_str()
        .to_owned();
    let (differences, unlisted) = classify_differences(
        &raw_differences,
        &ParityContext {
            launch: launch.clone(),
            attached: options.attached,
            extra_switches: comparison.extra.clone(),
            requested_args,
        },
    );
    Ok(ParityReport {
        browser: ParityBrowser {
            executable_path: executable.to_string_lossy().into_owned(),
            version: candidate_version
                .get("version")
                .and_then(Value::as_str)
                .unwrap_or("")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" "),
            engine: session.browser.engine,
            launch,
            headless: session.browser.headless,
        },
        command_line: ParityCommandLine {
            launched,
            reference: reference_command,
            comparison,
        },
        ok: unlisted.is_empty(),
        differences,
        unlisted,
    })
}

async fn measure(
    options: MeasureParityOptions,
    supplied: Option<&LaunchResult>,
) -> Result<ParityReport> {
    let real = options.launch.real_browser_options();
    let executable =
        if let Some(path) = supplied.and_then(|session| session.executable_path.clone()) {
            path
        } else {
            DefaultLaunchHooks {
                explicit_selection: options.launch.executable_path.is_some()
                    || options.launch.channel.is_some(),
            }
            .resolve_executable(&real)?
        };
    let server = ProbeServer::start().await?;
    let reference = reference::capture(&server, &executable, &options).await?;
    // A separate clean CDP launch reads version metadata without attaching to
    // the environment reference, which has already exited at this point.
    let version_options = LaunchOptions::chromiumoxide()
        .executable_path(&executable)
        .headless(options.launch.headless)
        .with_extra_args(options.reference_args.clone());
    let reference_session = launch_browser(version_options).await?;
    let reference_version = tokio::time::timeout(
        options.timeout,
        reference_session.page.read_browser_version_page(),
    )
    .await;
    let reference_closed = reference_session.close().await;
    let reference_version = reference_version??;
    reference_closed?;
    if let Some(session) = supplied {
        let (candidate, candidate_version) =
            capture_candidate(session, &server, options.timeout).await?;
        assemble_report(
            session,
            &options,
            &executable,
            reference,
            reference_version,
            candidate,
            candidate_version,
        )
    } else {
        let mut launch = options.launch.clone();
        launch.executable_path = Some(executable.clone());
        let session = launch_browser(launch).await?;
        let captured = capture_candidate(&session, &server, options.timeout).await;
        let closed = session.close().await;
        let (candidate, candidate_version) = captured?;
        closed?;
        assemble_report(
            &session,
            &options,
            &executable,
            reference,
            reference_version,
            candidate,
            candidate_version,
        )
    }
}

/// Launch and measure a browser, then close it and remove its owned temporary profile.
pub async fn measure_parity(options: MeasureParityOptions) -> Result<ParityReport> {
    measure(options, None).await
}

/// Measure an existing session without closing it. Navigation goes to the probe page.
/// The caller remains responsible for closing the supplied browser.
pub async fn measure_session_parity(
    session: &LaunchResult,
    mut options: MeasureParityOptions,
) -> Result<ParityReport> {
    options.launch.headless = session.browser.headless;
    options.launch.engine = session.browser.engine;
    measure(options, Some(session)).await
}

/// Read version metadata from a fresh tab, leaving the measured page untouched.
pub async fn read_browser_version_page(page: &dyn EngineAdapter) -> Result<Value> {
    Ok(page.read_browser_version_page().await?)
}
