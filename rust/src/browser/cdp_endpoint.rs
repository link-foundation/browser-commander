//! Waiting for a spawned browser's DevTools endpoint and proving it is ours
//! (issue #101).
//!
//! A reserved port is released before Chrome binds it, so another process can
//! take it in between. The endpoint is only trusted once the browser's own
//! stderr (or its `DevToolsActivePort` file) says it listens on that port, and
//! the `/json/version` served there names the same browser WebSocket URL the
//! browser announced; anything else is a [`PortRaceError`].

use std::future::Future;
use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::browser::browser_process::BrowserProcess;
use crate::browser::debugging_port::{
    assert_fixed_debugging_port, classify_dev_tools_ownership, DevToolsOutputWatcher,
    DevToolsOwnership, PortRaceError, LOOPBACK_HOST,
};

const POLL_INTERVAL: Duration = Duration::from_millis(100);
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);
const RESPONSE_LIMIT: usize = 1024 * 1024;

/// What [`wait_for_cdp_endpoint`] waits for.
#[derive(Debug, Clone, Copy)]
pub struct CdpEndpointRequest<'a> {
    /// The fixed port the browser was started with.
    pub remote_debugging_port: u16,
    /// The browser's profile, where it may write `DevToolsActivePort`.
    pub user_data_dir: &'a Path,
    /// The spawned browser.
    pub browser_process: &'a BrowserProcess,
    /// The browser's stderr, when it is captured. Without it ownership is
    /// only confirmed through `DevToolsActivePort`.
    pub dev_tools_output: Option<&'a DevToolsOutputWatcher>,
    /// How long to wait overall.
    pub timeout: Duration,
}

fn web_socket_debugger_url(response: &[u8]) -> Option<String> {
    if !(response.starts_with(b"HTTP/1.1 200") || response.starts_with(b"HTTP/1.0 200")) {
        return None;
    }
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")?;
    serde_json::from_slice::<Value>(&response[header_end + 4..])
        .ok()?
        .get("webSocketDebuggerUrl")?
        .as_str()
        .map(str::to_owned)
}

/// Fetch `/json/version` from the loopback DevTools server on `port` and
/// return its `webSocketDebuggerUrl`.
///
/// The response is parsed as soon as it is complete, without waiting for the
/// server to close the connection.
pub async fn fetch_cdp_version(port: u16, timeout: Duration) -> Option<String> {
    let request = format!(
        "GET /json/version HTTP/1.1\r\nHost: {LOOPBACK_HOST}:{port}\r\nConnection: close\r\n\r\n"
    );
    let request_future = async {
        let mut stream = TcpStream::connect((LOOPBACK_HOST, port)).await?;
        stream.write_all(request.as_bytes()).await?;
        let mut response = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let bytes_read = stream.read(&mut chunk).await?;
            if bytes_read == 0 {
                break;
            }
            response.extend_from_slice(&chunk[..bytes_read]);
            if let Some(url) = web_socket_debugger_url(&response) {
                return Ok::<Option<String>, io::Error>(Some(url));
            }
            if response.len() > RESPONSE_LIMIT {
                return Ok(None);
            }
        }
        Ok(web_socket_debugger_url(&response))
    };
    tokio::time::timeout(timeout, request_future)
        .await
        .ok()?
        .ok()?
}

/// Read the port from a profile's `DevToolsActivePort` file.
pub fn read_dev_tools_active_port(user_data_dir: &Path) -> Option<u16> {
    std::fs::read_to_string(user_data_dir.join("DevToolsActivePort"))
        .ok()?
        .lines()
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Wait until the browser's DevTools endpoint is ready and proven to be ours.
///
/// Returns `http://127.0.0.1:<port>`. Fails with a [`PortRaceError`] (inside
/// the [`anyhow::Error`]) when another process owns the port, and with a plain
/// error when the browser exits or `timeout` passes.
pub async fn wait_for_cdp_endpoint(request: CdpEndpointRequest<'_>) -> Result<String> {
    wait_for_cdp_endpoint_with(request, fetch_cdp_version).await
}

pub(crate) async fn wait_for_cdp_endpoint_with<P, F>(
    request: CdpEndpointRequest<'_>,
    probe: P,
) -> Result<String>
where
    P: Fn(u16, Duration) -> F,
    F: Future<Output = Option<String>>,
{
    let port = assert_fixed_debugging_port(request.remote_debugging_port)?;
    let endpoint = format!("http://{LOOPBACK_HOST}:{port}");
    let started = Instant::now();
    while started.elapsed() < request.timeout {
        let output = request
            .dev_tools_output
            .map(DevToolsOutputWatcher::state)
            .unwrap_or_default();
        let mut owned = match request.dev_tools_output {
            Some(_) => match classify_dev_tools_ownership(&output, port) {
                DevToolsOwnership::Race => {
                    let detail = output.listening.as_ref().map_or_else(
                        || "bind failed".to_owned(),
                        |listening| listening.url.clone(),
                    );
                    return Err(PortRaceError::new(port, detail).into());
                }
                DevToolsOwnership::Owned => true,
                DevToolsOwnership::Pending => false,
            },
            None => false,
        };
        if let Some(code) = request.browser_process.exit_code() {
            return Err(anyhow!(
                "Browser exited before its DevTools endpoint was ready (exit {code})"
            ));
        }
        if !owned && read_dev_tools_active_port(request.user_data_dir) == Some(port) {
            owned = true;
        }

        if owned {
            let remaining = request.timeout.saturating_sub(started.elapsed());
            // The HTTP handler can lag the listening line by a moment, so an
            // unanswered probe is simply retried.
            if let Some(served) = probe(port, remaining.min(PROBE_TIMEOUT)).await {
                if let Some(announced) = output.listening.as_ref().map(|listening| &listening.url) {
                    if &served != announced {
                        return Err(PortRaceError::new(
                            port,
                            format!("port serves {served}, browser announced {announced}"),
                        )
                        .into());
                    }
                }
                return Ok(endpoint);
            }
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
    Err(anyhow!(
        "Timed out after {}ms waiting for the DevTools endpoint on port {port}",
        request.timeout.as_millis()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::browser_process::fake::FakeProcess;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    const ANNOUNCED: &str = "ws://127.0.0.1:40001/devtools/browser/ours";

    fn request<'a>(
        process: &'a BrowserProcess,
        watcher: &'a DevToolsOutputWatcher,
        timeout: Duration,
    ) -> CdpEndpointRequest<'a> {
        CdpEndpointRequest {
            remote_debugging_port: 40001,
            user_data_dir: Path::new("/nonexistent/browser-commander-profile"),
            browser_process: process,
            dev_tools_output: Some(watcher),
            timeout,
        }
    }

    #[tokio::test]
    async fn returns_the_endpoint_once_ownership_is_confirmed() {
        let process = FakeProcess::new().handle();
        let watcher = DevToolsOutputWatcher::new();
        watcher.push(format!("\nDevTools listening on {ANNOUNCED}\n").as_bytes());

        let endpoint = wait_for_cdp_endpoint_with(
            request(&process, &watcher, Duration::from_secs(2)),
            |_, _| async { Some(ANNOUNCED.to_owned()) },
        )
        .await
        .unwrap();

        assert_eq!(endpoint, "http://127.0.0.1:40001");
    }

    #[tokio::test]
    async fn reports_a_race_when_the_port_serves_another_browser() {
        let process = FakeProcess::new().handle();
        let watcher = DevToolsOutputWatcher::new();
        watcher.push(format!("DevTools listening on {ANNOUNCED}\n").as_bytes());

        let error = wait_for_cdp_endpoint_with(
            request(&process, &watcher, Duration::from_secs(2)),
            |_, _| async { Some("ws://127.0.0.1:40001/devtools/browser/theirs".to_owned()) },
        )
        .await
        .unwrap_err();

        let race = error
            .downcast_ref::<PortRaceError>()
            .expect("a PortRaceError");
        assert_eq!(race.port, 40001);
        assert!(error.to_string().contains("browser announced"), "{error}");
    }

    #[tokio::test]
    async fn reports_a_race_on_the_ipv6_fallback_without_probing() {
        let process = FakeProcess::new().handle();
        let watcher = DevToolsOutputWatcher::new();
        watcher.push(b"DevTools listening on ws://[::1]:40001/devtools/browser/ours\n");
        let probes = AtomicUsize::new(0);

        let error = wait_for_cdp_endpoint_with(
            request(&process, &watcher, Duration::from_secs(2)),
            |_, _| {
                probes.fetch_add(1, Ordering::SeqCst);
                async { None }
            },
        )
        .await
        .unwrap_err();

        assert!(error.downcast_ref::<PortRaceError>().is_some(), "{error}");
        assert_eq!(probes.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn does_not_probe_before_the_browser_claims_the_port() {
        let process = FakeProcess::new().handle();
        let watcher = DevToolsOutputWatcher::new();
        let probes = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&probes);

        let error = wait_for_cdp_endpoint_with(
            request(&process, &watcher, Duration::from_millis(250)),
            move |_, _| {
                counter.fetch_add(1, Ordering::SeqCst);
                async { Some(ANNOUNCED.to_owned()) }
            },
        )
        .await
        .unwrap_err();

        assert!(error.to_string().starts_with("Timed out"), "{error}");
        assert_eq!(probes.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn reports_an_early_exit() {
        let fake = FakeProcess::new();
        fake.exit(21);
        let process = fake.handle();
        let watcher = DevToolsOutputWatcher::new();

        let error = wait_for_cdp_endpoint_with(
            request(&process, &watcher, Duration::from_secs(2)),
            |_, _| async { None },
        )
        .await
        .unwrap_err();

        assert!(error.to_string().contains("(exit 21)"), "{error}");
    }

    #[tokio::test]
    async fn confirms_ownership_through_dev_tools_active_port() {
        let profile =
            crate::browser::profile_directory::create_temporary_user_data_dir(None).unwrap();
        std::fs::write(
            profile.join("DevToolsActivePort"),
            "40001\n/devtools/browser/x",
        )
        .unwrap();
        let process = FakeProcess::new().handle();

        let endpoint = wait_for_cdp_endpoint_with(
            CdpEndpointRequest {
                remote_debugging_port: 40001,
                user_data_dir: &profile,
                browser_process: &process,
                dev_tools_output: None,
                timeout: Duration::from_secs(2),
            },
            |_, _| async { Some(ANNOUNCED.to_owned()) },
        )
        .await
        .unwrap();

        assert_eq!(endpoint, "http://127.0.0.1:40001");
        std::fs::remove_dir_all(profile).unwrap();
    }

    #[tokio::test]
    async fn cdp_probe_does_not_wait_for_the_server_to_close_the_connection() {
        let listener = tokio::net::TcpListener::bind((LOOPBACK_HOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let response_body = r#"{"webSocketDebuggerUrl":"ws://127.0.0.1/devtools/browser/id"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{response_body}",
            response_body.len()
        );
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            stream.write_all(response.as_bytes()).await.unwrap();
            tokio::time::sleep(Duration::from_secs(1)).await;
        });

        assert_eq!(
            fetch_cdp_version(port, Duration::from_millis(200)).await,
            Some("ws://127.0.0.1/devtools/browser/id".to_owned())
        );
        server.abort();
    }
}
