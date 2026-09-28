//! Fixed remote debugging ports for the real browser (issue #101).
//!
//! A fixed, non-zero `--remote-debugging-port` is the only CDP transport that
//! leaves `navigator.webdriver` false without the unsupported
//! `--disable-blink-features=AutomationControlled` switch: Chromium's
//! `content/child/runtime_features.cc` treats `--remote-debugging-pipe` and
//! `--remote-debugging-port=0` as automation, but a specific port as a human
//! attaching a debugger.
//!
//! The port is reserved by binding `127.0.0.1:0`, reading the port the kernel
//! picked and closing the socket. Another process can take the port between
//! that close and Chrome's bind, so the launcher confirms ownership and
//! retries.
//!
//! Chrome only writes `DevToolsActivePort` into the profile for port 0 (see
//! `chrome/browser/devtools/remote_debugging_server.cc`), so for a fixed port
//! ownership is confirmed from the line Chromium prints to stderr when its
//! DevTools server starts:
//!
//! ```text
//! DevTools listening on ws://127.0.0.1:<port>/devtools/browser/<id>
//! ```
//!
//! When the loopback port is taken Chromium logs `bind() failed: Address
//! already in use` and falls back to `[::1]:<port>`; when both fail it logs
//! `Cannot start http server for devtools`. Either outcome is reported as a
//! race. This mirrors `js/src/browser/debugging-port.js`.

use std::fmt;
use std::net::{Ipv4Addr, SocketAddr, TcpListener};
use std::sync::{Arc, LazyLock, Mutex};

use anyhow::{anyhow, Result};
use regex::Regex;

use crate::utilities::subprocess::OutputListener;

/// Interface the reserved port and the DevTools server are bound to.
pub const LOOPBACK_HOST: &str = "127.0.0.1";

/// Most stderr kept while waiting for the DevTools line; only the startup
/// lines matter.
const OUTPUT_BUFFER_LIMIT: usize = 65_536;

/// The reserved port was taken before the browser could bind it.
///
/// The launcher retries with a new port when it reserved the port itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortRaceError {
    /// The port that was lost.
    pub port: u16,
    /// What gave the race away, if known.
    pub detail: Option<String>,
}

impl PortRaceError {
    /// Create a race error for `port`.
    pub fn new(port: u16, detail: impl Into<Option<String>>) -> Self {
        Self {
            port,
            detail: detail.into(),
        }
    }
}

impl fmt::Display for PortRaceError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "Remote debugging port {} was taken by another process before the browser bound it",
            self.port
        )?;
        match &self.detail {
            Some(detail) if !detail.is_empty() => write!(formatter, " ({detail})"),
            _ => Ok(()),
        }
    }
}

impl std::error::Error for PortRaceError {}

/// Reserve a free loopback TCP port for `--remote-debugging-port`.
///
/// Binds `127.0.0.1:0`, reads the port the kernel picked and closes the
/// socket again, so the port was free a moment ago.
pub fn reserve_loopback_port() -> Result<u16> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|error| anyhow!("Could not reserve a loopback port: {error}"))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

/// Validate a caller-supplied debugging port; zero is refused on purpose,
/// because port 0 makes Chrome enable AutomationControlled.
pub fn assert_fixed_debugging_port(port: u16) -> Result<u16> {
    if port == 0 {
        return Err(anyhow!(
            "remote_debugging_port 0 makes Chrome enable AutomationControlled (navigator.webdriver === true); omit it so a free fixed port is reserved"
        ));
    }
    Ok(port)
}

/// The `DevTools listening on ...` announcement.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DevToolsListening {
    /// Full browser WebSocket URL.
    pub url: String,
    /// Host the server bound, without IPv6 brackets.
    pub host: String,
    /// Port the server bound.
    pub port: u16,
}

/// What the browser's stderr says about its DevTools server so far.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DevToolsOutput {
    /// The listening announcement, once printed.
    pub listening: Option<DevToolsListening>,
    /// Whether DevTools gave up binding its HTTP server.
    pub bind_failed: bool,
}

static LISTENING_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"DevTools listening on (ws://(\[[^\]]+\]|[^:/\s]+):(\d+)/devtools/browser/[^\s]+)")
        .expect("valid DevTools listening pattern")
});

// A bare `bind() failed` can come from unrelated sockets (media router, mDNS),
// so only DevTools' own give-up message counts as a failure on its own.
static BIND_FAILURE_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)Cannot start http server for devtools")
        .expect("valid DevTools bind failure pattern")
});

/// Parse Chromium's DevTools startup output.
pub fn parse_dev_tools_output(text: &str) -> DevToolsOutput {
    let listening = LISTENING_PATTERN.captures(text).and_then(|captures| {
        let port = captures[3].parse::<u16>().ok()?;
        Some(DevToolsListening {
            url: captures[1].to_owned(),
            host: captures[2]
                .trim_start_matches('[')
                .trim_end_matches(']')
                .to_owned(),
            port,
        })
    });
    DevToolsOutput {
        listening,
        bind_failed: BIND_FAILURE_PATTERN.is_match(text),
    }
}

#[derive(Debug, Default)]
struct WatcherState {
    text: String,
    settled: Option<DevToolsOutput>,
}

/// Collects a browser's stderr so the launcher can confirm which process owns
/// the debugging port.
///
/// Register [`listener`](Self::listener) with the process before it starts;
/// the process output keeps being drained after startup so a chatty browser
/// never blocks on a full pipe.
#[derive(Debug, Clone, Default)]
pub struct DevToolsOutputWatcher {
    state: Arc<Mutex<WatcherState>>,
}

impl DevToolsOutputWatcher {
    /// Create an empty watcher.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed a chunk of stderr.
    pub fn push(&self, chunk: &[u8]) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        if state.settled.is_some() {
            return;
        }
        state.text.push_str(&String::from_utf8_lossy(chunk));
        if state.text.len() > OUTPUT_BUFFER_LIMIT {
            let mut start = state.text.len() - OUTPUT_BUFFER_LIMIT;
            while !state.text.is_char_boundary(start) {
                start += 1;
            }
            state.text.drain(..start);
        }
        let parsed = parse_dev_tools_output(&state.text);
        if parsed.listening.is_some() {
            state.settled = Some(parsed);
        }
    }

    /// A stderr listener that feeds this watcher.
    pub fn listener(&self) -> OutputListener {
        let watcher = self.clone();
        Arc::new(move |chunk: &[u8]| watcher.push(chunk))
    }

    /// The DevTools state seen so far.
    pub fn state(&self) -> DevToolsOutput {
        let Ok(state) = self.state.lock() else {
            return DevToolsOutput::default();
        };
        state
            .settled
            .clone()
            .unwrap_or_else(|| parse_dev_tools_output(&state.text))
    }
}

/// Whether the DevTools output proves the port is ours, proves a race, or is
/// not conclusive yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DevToolsOwnership {
    /// Our browser announced a loopback server on the reserved port.
    Owned,
    /// Our browser bound elsewhere, or gave up binding.
    Race,
    /// Nothing conclusive has been printed yet.
    Pending,
}

/// Decide whether the DevTools output proves that `port` belongs to our
/// browser, proves a race, or is not conclusive yet.
pub fn classify_dev_tools_ownership(output: &DevToolsOutput, port: u16) -> DevToolsOwnership {
    match &output.listening {
        Some(listening) if listening.port == port && listening.host == LOOPBACK_HOST => {
            DevToolsOwnership::Owned
        }
        Some(_) => DevToolsOwnership::Race,
        None if output.bind_failed => DevToolsOwnership::Race,
        None => DevToolsOwnership::Pending,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reserves_a_bindable_non_zero_port() {
        let port = reserve_loopback_port().unwrap();
        assert_ne!(port, 0);
        TcpListener::bind((LOOPBACK_HOST, port)).unwrap();
    }

    #[test]
    fn refuses_port_zero() {
        let error = assert_fixed_debugging_port(0).unwrap_err().to_string();
        assert!(error.contains("AutomationControlled"), "{error}");
        assert_eq!(assert_fixed_debugging_port(9222).unwrap(), 9222);
    }

    #[test]
    fn parses_the_listening_line_and_bind_failures() {
        let output = parse_dev_tools_output(
            "noise\nDevTools listening on ws://127.0.0.1:40001/devtools/browser/abc-123\n",
        );
        assert_eq!(
            output.listening,
            Some(DevToolsListening {
                url: "ws://127.0.0.1:40001/devtools/browser/abc-123".to_owned(),
                host: "127.0.0.1".to_owned(),
                port: 40001,
            })
        );
        assert!(!output.bind_failed);

        let fallback =
            parse_dev_tools_output("DevTools listening on ws://[::1]:40001/devtools/browser/x");
        assert_eq!(fallback.listening.unwrap().host, "::1");

        let failed = parse_dev_tools_output(
            "bind() failed: Address already in use\nCannot start http server for devtools.",
        );
        assert!(failed.bind_failed);
        assert!(!parse_dev_tools_output("bind() failed: Address already in use").bind_failed);
    }

    #[test]
    fn classifies_ownership() {
        let owned =
            parse_dev_tools_output("DevTools listening on ws://127.0.0.1:40001/devtools/browser/a");
        assert_eq!(
            classify_dev_tools_ownership(&owned, 40001),
            DevToolsOwnership::Owned
        );
        assert_eq!(
            classify_dev_tools_ownership(&owned, 40002),
            DevToolsOwnership::Race
        );
        let fallback =
            parse_dev_tools_output("DevTools listening on ws://[::1]:40001/devtools/browser/a");
        assert_eq!(
            classify_dev_tools_ownership(&fallback, 40001),
            DevToolsOwnership::Race
        );
        assert_eq!(
            classify_dev_tools_ownership(&DevToolsOutput::default(), 40001),
            DevToolsOwnership::Pending
        );
    }

    #[test]
    fn watcher_settles_on_the_listening_line_across_chunks() {
        let watcher = DevToolsOutputWatcher::new();
        let listener = watcher.listener();
        listener(b"DevTools listening on ws://127.0.0.1:4");
        assert_eq!(watcher.state().listening, None);
        listener(b"0001/devtools/browser/a\n");
        listener(b"Cannot start http server for devtools\n");
        let state = watcher.state();
        assert_eq!(state.listening.unwrap().port, 40001);
        assert!(!state.bind_failed);
        assert_eq!(
            PortRaceError::new(1, None).to_string(),
            "Remote debugging port 1 was taken by another process before the browser bound it"
        );
    }
}
