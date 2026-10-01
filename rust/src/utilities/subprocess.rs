//! Subprocesses through command-stream (issue #104).
//!
//! Every subprocess Browser Commander starts - the real browser, the credential
//! tools (`security`, `secret-tool`, `kwallet-query`, `powershell.exe`,
//! `icacls`, `whoami`) and anything else run to completion - goes through the
//! [`command_stream`] crate. Its argv mode runs the file directly with exact
//! argument boundaries, no shell in between, and gives one consistent surface
//! for streaming output, cancellation and exit codes. This module mirrors
//! `js/src/utilities/subprocess.js` and the Python `subprocess` wrapper: the
//! same two functions, [`run_command`] and [`start_process`], with snake_case
//! names.

use std::collections::HashMap;
use std::fmt;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use command_stream::{OutputChunk, StreamingRunner};
use tokio::sync::{mpsc, watch};
#[path = "process_cleanup.rs"]
mod process_cleanup;

/// Milliseconds between the polite signal and `SIGKILL` when a process started
/// by [`start_process`] is stopped, matching the JavaScript `killGrace` default.
pub const DEFAULT_KILL_GRACE: Duration = Duration::from_millis(2000);

/// Output of a command run to completion by [`run_command`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CommandOutput {
    /// Everything the command wrote to stdout, decoded lossily as UTF-8.
    pub stdout: String,
    /// Everything the command wrote to stderr, decoded lossily as UTF-8.
    pub stderr: String,
    /// Exit code; a signal exit is reported as `128 + signal`.
    pub code: i32,
}

/// Failure to run a command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandError {
    /// The executable could not be started at all (for example it is missing).
    Spawn {
        /// Executable that was requested.
        file: String,
        /// Exact arguments that were requested.
        args: Vec<String>,
        /// Why the spawn failed.
        message: String,
    },
    /// The command ran and exited with a non-zero status while `check` was on.
    Exited {
        /// Executable that ran.
        file: String,
        /// Exact arguments it ran with.
        args: Vec<String>,
        /// Its exit code.
        code: i32,
        /// Its captured stdout.
        stdout: String,
        /// Its captured stderr.
        stderr: String,
    },
}

impl CommandError {
    /// Exit code of the command, when it ran at all.
    pub fn code(&self) -> Option<i32> {
        match self {
            Self::Spawn { .. } => None,
            Self::Exited { code, .. } => Some(*code),
        }
    }

    /// Executable the error is about.
    pub fn file(&self) -> &str {
        match self {
            Self::Spawn { file, .. } | Self::Exited { file, .. } => file,
        }
    }
}

impl fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn { file, message, .. } => {
                write!(formatter, "Could not start {file}: {message}")
            }
            Self::Exited {
                file, code, stderr, ..
            } => {
                let stderr = stderr.trim();
                if stderr.is_empty() {
                    write!(formatter, "{file} exited with code {code}")
                } else {
                    write!(formatter, "{file} exited with code {code}: {stderr}")
                }
            }
        }
    }
}

impl std::error::Error for CommandError {}

/// Options for [`run_command`].
#[derive(Debug, Clone)]
pub struct RunCommandOptions {
    /// Extra environment for the child only; the parent's environment is never
    /// modified.
    pub env: Option<HashMap<String, String>>,
    /// Working directory.
    pub cwd: Option<PathBuf>,
    /// Data written to the child's stdin; stdin is closed (null) otherwise.
    pub input: Option<String>,
    /// Return [`CommandError::Exited`] on a non-zero exit (default `true`).
    pub check: bool,
}

impl Default for RunCommandOptions {
    fn default() -> Self {
        Self {
            env: None,
            cwd: None,
            input: None,
            check: true,
        }
    }
}

fn owned_args<S: AsRef<str>>(args: &[S]) -> Vec<String> {
    args.iter().map(|arg| arg.as_ref().to_owned()).collect()
}

fn runner_for(
    file: &str,
    args: &[String],
    env: Option<HashMap<String, String>>,
    cwd: Option<PathBuf>,
) -> StreamingRunner {
    let mut runner = StreamingRunner::from_argv(file, args);
    if let Some(env) = env {
        runner = runner.env(env);
    }
    if let Some(cwd) = cwd {
        runner = runner.cwd(cwd);
    }
    runner
}

fn finish(
    file: &str,
    args: Vec<String>,
    check: bool,
    result: command_stream::Result<command_stream::CommandResult>,
) -> Result<CommandOutput, CommandError> {
    let result = result.map_err(|error| CommandError::Spawn {
        file: file.to_owned(),
        args: args.clone(),
        message: match error {
            command_stream::Error::Io(io) => io.to_string(),
            other => other.to_string(),
        },
    })?;
    let output = CommandOutput {
        stdout: result.stdout.to_string(),
        stderr: result.stderr.to_string(),
        code: result.code,
    };
    if check && output.code != 0 {
        return Err(CommandError::Exited {
            file: file.to_owned(),
            args,
            code: output.code,
            stdout: output.stdout,
            stderr: output.stderr,
        });
    }
    Ok(output)
}

/// Run a command to completion and return its output.
///
/// `file` is resolved through `PATH` and receives exactly `args`; no shell is
/// involved.
pub async fn run_command<S: AsRef<str>>(
    file: &str,
    args: &[S],
    options: RunCommandOptions,
) -> Result<CommandOutput, CommandError> {
    let args = owned_args(args);
    let mut runner = runner_for(file, &args, options.env, options.cwd);
    if let Some(input) = options.input {
        runner = runner.stdin(input);
    }
    let result = runner.collect().await;
    finish(file, args, options.check, result)
}

/// Synchronous [`run_command`] for code that is not async, such as the
/// credential-store readers.
///
/// command-stream's blocking collector refuses to run inside a Tokio runtime,
/// so when one is active the command is collected on a short-lived thread of
/// its own instead.
pub fn run_command_blocking<S: AsRef<str>>(
    file: &str,
    args: &[S],
    options: RunCommandOptions,
) -> Result<CommandOutput, CommandError> {
    let args = owned_args(args);
    let mut runner = runner_for(file, &args, options.env, options.cwd);
    if let Some(input) = options.input {
        runner = runner.stdin(input);
    }
    let result = if tokio::runtime::Handle::try_current().is_ok() {
        std::thread::spawn(move || runner.collect_blocking())
            .join()
            .unwrap_or_else(|_| {
                Err(std::io::Error::other("the command collector thread panicked").into())
            })
    } else {
        runner.collect_blocking()
    };
    finish(file, args, options.check, result)
}

/// Callback receiving raw output chunks of a process started by
/// [`start_process`].
pub type OutputListener = Arc<dyn Fn(&[u8]) + Send + Sync>;

/// Options for [`start_process`].
#[derive(Clone)]
pub struct StartProcessOptions {
    /// Extra environment for the child only; the parent's environment is never
    /// modified.
    pub env: Option<HashMap<String, String>>,
    /// Working directory.
    pub cwd: Option<PathBuf>,
    /// Mirror the child's output to this process's stdout/stderr.
    pub forward_output: bool,
    /// Time between the polite signal and `SIGKILL` when the process is stopped.
    pub kill_grace: Duration,
    /// Listeners registered before the spawn, so no early output is missed.
    pub on_stdout: Vec<OutputListener>,
    /// Listeners registered before the spawn, so no early output is missed -
    /// used to watch for the `DevTools listening on ...` line.
    pub on_stderr: Vec<OutputListener>,
}

impl Default for StartProcessOptions {
    fn default() -> Self {
        Self {
            env: None,
            cwd: None,
            forward_output: false,
            kill_grace: DEFAULT_KILL_GRACE,
            on_stdout: Vec::new(),
            on_stderr: Vec::new(),
        }
    }
}

impl fmt::Debug for StartProcessOptions {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("StartProcessOptions")
            .field("env", &self.env)
            .field("cwd", &self.cwd)
            .field("forward_output", &self.forward_output)
            .field("kill_grace", &self.kill_grace)
            .field("on_stdout", &self.on_stdout.len())
            .field("on_stderr", &self.on_stderr.len())
            .finish()
    }
}

type ListenerList = Arc<Mutex<Vec<OutputListener>>>;

fn emit(listeners: &ListenerList, chunk: &[u8]) {
    let listeners = listeners
        .lock()
        .map(|listeners| listeners.clone())
        .unwrap_or_default();
    for listener in listeners {
        listener(chunk);
    }
}

/// Handle for a long-running process started by [`start_process`], such as a
/// browser.
///
/// Dropping the handle asks command-stream to stop the process; call
/// [`kill`](Self::kill) and [`wait`](Self::wait) for deterministic cleanup.
pub struct ManagedProcess {
    file: String,
    pid: Option<u32>,
    exit: watch::Receiver<Option<i32>>,
    kill_requests: mpsc::UnboundedSender<String>,
    stdout: ListenerList,
    stderr: ListenerList,
}

impl fmt::Debug for ManagedProcess {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ManagedProcess")
            .field("file", &self.file)
            .field("pid", &self.pid)
            .field("exit_code", &self.exit_code())
            .finish()
    }
}

impl ManagedProcess {
    /// Operating system process id.
    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    /// Exit code once the process has exited (`128 + signal` for a signal).
    pub fn exit_code(&self) -> Option<i32> {
        *self.exit.borrow()
    }

    /// Whether the process is still running.
    pub fn is_running(&self) -> bool {
        self.exit_code().is_none()
    }

    /// Register another stdout listener. Output already delivered is not
    /// replayed; pass listeners in [`StartProcessOptions`] to see everything.
    pub fn on_stdout(&self, listener: OutputListener) {
        if let Ok(mut listeners) = self.stdout.lock() {
            listeners.push(listener);
        }
    }

    /// Register another stderr listener. Output already delivered is not
    /// replayed; pass listeners in [`StartProcessOptions`] to see everything.
    pub fn on_stderr(&self, listener: OutputListener) {
        if let Ok(mut listeners) = self.stderr.lock() {
            listeners.push(listener);
        }
    }

    /// Stop the process with `SIGTERM`, then `SIGKILL` after the grace period.
    ///
    /// Returns whether a running process was signalled.
    pub fn kill(&self) -> bool {
        self.kill_with("SIGTERM")
    }

    /// Stop the process with an explicit signal name, then `SIGKILL` after the
    /// grace period. Returns whether a running process was signalled.
    pub fn kill_with(&self, signal: &str) -> bool {
        if !self.is_running() {
            return false;
        }
        self.kill_requests.send(signal.to_owned()).is_ok()
    }

    /// Wait for the process to exit and return its exit code.
    pub async fn wait(&self) -> i32 {
        let mut exit = self.exit.clone();
        let code = match exit.wait_for(Option::is_some).await {
            Ok(code) => code.unwrap_or(1),
            Err(_) => self.exit_code().unwrap_or(1),
        };
        code
    }

    /// Wait up to `timeout` for the process to exit; `None` if it is still
    /// running afterwards.
    pub async fn wait_timeout(&self, timeout: Duration) -> Option<i32> {
        tokio::time::timeout(timeout, self.wait()).await.ok()
    }

    /// A future that resolves with the exit code once the process exits.
    ///
    /// Unlike [`wait`](Self::wait) it does not borrow the handle, so it can be
    /// moved into a task (the launcher uses it to delete a temporary profile
    /// as soon as the browser is gone).
    pub fn exited(&self) -> impl std::future::Future<Output = i32> + Send + 'static {
        let mut exit = self.exit.clone();
        async move {
            let waited = exit.wait_for(Option::is_some).await.map(|code| *code);
            match waited {
                Ok(code) => code.unwrap_or(1),
                Err(_) => exit.borrow().unwrap_or(1),
            }
        }
    }
}

/// Kill a command-stream child and every process in its group (Unix) or tree
/// (Windows), synchronously. For owners of a raw command-stream
/// `ProcessRunner`, such as the Playwright driver pipe.
pub(crate) fn kill_owned_process_tree(pid: u32) {
    process_cleanup::kill_owned_process_tree(pid);
}

impl Drop for ManagedProcess {
    fn drop(&mut self) {
        // Drop can run after its Tokio runtime has shut down. An async kill
        // request alone can then never reach command-stream's pump. Explicit
        // close/kill keeps the grace period; final abandoned ownership is killed
        // synchronously so browser and driver children cannot escape.
        if self.is_running() {
            if let Some(pid) = self.pid {
                process_cleanup::kill_owned_process_tree(pid);
            }
            self.kill();
        }
    }
}

/// Start a long-running process, such as a browser.
///
/// `file` receives exactly `args`, without a shell. The process's output is
/// drained continuously and delivered to the listeners in `options`. Must be
/// called inside a Tokio runtime.
pub async fn start_process<S: AsRef<str>>(
    file: &str,
    args: &[S],
    options: StartProcessOptions,
) -> Result<ManagedProcess, CommandError> {
    let args = owned_args(args);
    let kill_grace_ms = u64::try_from(options.kill_grace.as_millis()).unwrap_or(u64::MAX);
    let mut stream = runner_for(file, &args, options.env, options.cwd)
        .kill_grace_ms(kill_grace_ms)
        .stream();
    let Some(pid) = stream.wait_for_pid().await else {
        // command-stream reports a failed spawn by never publishing a pid; the
        // underlying io::Error stays inside its task, so describe the common
        // cause ourselves.
        let message =
            if PathBuf::from(file).components().count() > 1 && !PathBuf::from(file).exists() {
                "no such file".to_owned()
            } else {
                "the executable could not be spawned (missing or not executable)".to_owned()
            };
        return Err(CommandError::Spawn {
            file: file.to_owned(),
            args,
            message,
        });
    };

    let stdout: ListenerList = Arc::new(Mutex::new(options.on_stdout));
    let stderr: ListenerList = Arc::new(Mutex::new(options.on_stderr));
    let (exit_tx, exit_rx) = watch::channel(None);
    let (kill_tx, mut kill_rx) = mpsc::unbounded_channel::<String>();
    let forward = options.forward_output;
    let pump_stdout = Arc::clone(&stdout);
    let pump_stderr = Arc::clone(&stderr);

    tokio::spawn(async move {
        let mut code = None;
        let mut kill_open = true;
        loop {
            tokio::select! {
                chunk = stream.next() => match chunk {
                    Some(OutputChunk::Stdout(data)) => {
                        if forward {
                            let _ = std::io::stdout().write_all(&data);
                        }
                        emit(&pump_stdout, &data);
                    }
                    Some(OutputChunk::Stderr(data)) => {
                        if forward {
                            let _ = std::io::stderr().write_all(&data);
                        }
                        emit(&pump_stderr, &data);
                    }
                    Some(OutputChunk::Exit(exit_code)) => code = Some(exit_code),
                    None => break,
                },
                signal = kill_rx.recv(), if kill_open => match signal {
                    Some(signal) => stream.kill_with(&signal),
                    None => kill_open = false,
                },
            }
        }
        let _ = exit_tx.send(Some(code.unwrap_or(1)));
    });

    Ok(ManagedProcess {
        file: file.to_owned(),
        pid: Some(pid),
        exit: exit_rx,
        kill_requests: kill_tx,
        stdout,
        stderr,
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn run_command_passes_exact_argv_without_a_shell() {
        let output = run_command(
            "printf",
            &["%s|", "a b", "$HOME", "'quoted'"],
            RunCommandOptions::default(),
        )
        .await
        .unwrap();
        assert_eq!(output.stdout, "a b|$HOME|'quoted'|");
        assert_eq!(output.code, 0);
    }

    #[tokio::test]
    async fn run_command_reports_non_zero_exits() {
        let error = run_command(
            "sh",
            &["-c", "echo nope >&2; exit 3"],
            RunCommandOptions::default(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.code(), Some(3));
        assert_eq!(error.to_string(), "sh exited with code 3: nope");

        let unchecked = run_command(
            "sh",
            &["-c", "exit 4"],
            RunCommandOptions {
                check: false,
                ..RunCommandOptions::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(unchecked.code, 4);
    }

    #[tokio::test]
    async fn run_command_reports_missing_executables() {
        let error = run_command(
            "browser-commander-definitely-missing",
            &[] as &[&str],
            RunCommandOptions::default(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, CommandError::Spawn { .. }));
        assert_eq!(error.code(), None);
    }

    #[tokio::test]
    async fn run_command_sets_env_and_input_for_the_child_only() {
        let output = run_command(
            "sh",
            &["-c", "printf '%s:' \"$BC_SUBPROCESS_TEST\"; cat"],
            RunCommandOptions {
                env: Some(HashMap::from([(
                    "BC_SUBPROCESS_TEST".to_owned(),
                    "child".to_owned(),
                )])),
                input: Some("stdin".to_owned()),
                ..RunCommandOptions::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(output.stdout, "child:stdin");
        assert!(std::env::var_os("BC_SUBPROCESS_TEST").is_none());
    }

    #[tokio::test]
    async fn run_command_blocking_works_inside_and_outside_a_runtime() {
        let inside = run_command_blocking("echo", &["inside"], RunCommandOptions::default());
        assert_eq!(inside.unwrap().stdout, "inside\n");
        let outside = std::thread::spawn(|| {
            run_command_blocking("echo", &["outside"], RunCommandOptions::default())
        })
        .join()
        .unwrap();
        assert_eq!(outside.unwrap().stdout, "outside\n");
    }

    #[tokio::test]
    async fn start_process_streams_stderr_and_reports_the_exit() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let process = start_process(
            "sh",
            &["-c", "echo ready >&2; exit 5"],
            StartProcessOptions {
                on_stderr: vec![Arc::new(move |chunk: &[u8]| {
                    sink.lock().unwrap().extend_from_slice(chunk);
                })],
                ..StartProcessOptions::default()
            },
        )
        .await
        .unwrap();
        assert!(process.pid().is_some());
        assert_eq!(process.wait().await, 5);
        assert_eq!(process.exit_code(), Some(5));
        assert!(!process.kill());
        assert_eq!(seen.lock().unwrap().as_slice(), b"ready\n");
    }

    #[tokio::test]
    async fn start_process_kills_with_grace() {
        let process = start_process(
            "sleep",
            &["30"],
            StartProcessOptions {
                kill_grace: Duration::from_millis(200),
                ..StartProcessOptions::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(process.wait_timeout(Duration::from_millis(100)).await, None);
        assert!(process.kill());
        let code = process.wait_timeout(Duration::from_secs(5)).await;
        assert_eq!(code, Some(128 + 15));
    }

    #[tokio::test]
    async fn start_process_reports_spawn_failures() {
        let error = start_process(
            "/nonexistent/browser-commander-missing",
            &[] as &[&str],
            StartProcessOptions::default(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, CommandError::Spawn { .. }));
    }
}
