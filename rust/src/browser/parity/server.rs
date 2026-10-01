//! Bounded loopback HTTP collector for the shared environment probe.

use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio::task::{JoinHandle, JoinSet};

use super::PROBE_SOURCE;

const MAX_HEADER_BYTES: usize = 64 * 1024;
const MAX_REPORT_BYTES: usize = 4 * 1024 * 1024;

pub(super) struct ProbeServer {
    pub reference_url: String,
    pub candidate_url: String,
    reference: watch::Receiver<Option<Value>>,
    candidate: watch::Receiver<Option<Value>>,
    task: JoinHandle<()>,
}

impl ProbeServer {
    pub async fn start() -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let address = listener.local_addr()?;
        let mut bytes = [0u8; 32];
        getrandom::fill(&mut bytes).map_err(|error| anyhow::anyhow!("probe token: {error}"))?;
        let token = |slice: &[u8]| {
            slice
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        };
        let reference_token = token(&bytes[..16]);
        let candidate_token = token(&bytes[16..]);
        let reference_url = format!("http://{address}/probe/{reference_token}");
        let candidate_url = format!("http://{address}/probe/{candidate_token}");
        let (reference_tx, reference) = watch::channel(None);
        let (candidate_tx, candidate) = watch::channel(None);
        let task = tokio::spawn(async move {
            // JoinSet aborts every accepted connection when the server is dropped.
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let Ok((socket, _)) = accepted else { break; };
                        if connections.len() >= 32 { continue; }
                        let tokens = [reference_token.clone(), candidate_token.clone()];
                        let senders = [reference_tx.clone(), candidate_tx.clone()];
                        connections.spawn(async move {
                            match tokio::time::timeout(Duration::from_secs(10), serve(socket, tokens, senders)).await {
                                Ok(Ok(())) => {}
                                result => tracing::debug!(?result, "parity probe request failed"),
                            }
                        });
                    }
                    _ = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        });
        Ok(Self {
            reference_url,
            candidate_url,
            reference,
            candidate,
            task,
        })
    }

    pub async fn report(&self, reference: bool, timeout: Duration) -> Result<Value> {
        let mut receiver = if reference {
            self.reference.clone()
        } else {
            self.candidate.clone()
        };
        let report = tokio::time::timeout(timeout, receiver.wait_for(Option::is_some))
            .await
            .context("timed out waiting for parity probe report")?
            .context("parity probe server closed")?
            .clone()
            .context("empty parity report")?;
        if let Some(error) = report.get("fatal") {
            bail!("parity probe failed: {error}");
        }
        Ok(report)
    }
}

impl Drop for ProbeServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

fn page(token: &str) -> String {
    format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><title>probe</title></head>
<body><p id="status">running</p><script>
({PROBE_SOURCE})()
.then(report => fetch('/report/{token}', {{method:'POST',headers:{{'content-type':'application/json'}},body:JSON.stringify(report)}}))
.then(() => {{document.getElementById('status').textContent='done';}})
.catch(error => fetch('/report/{token}', {{method:'POST',headers:{{'content-type':'application/json'}},body:JSON.stringify({{fatal:String(error && error.stack || error)}})}}));
</script></body></html>"#
    )
}

async fn respond(reader: &mut BufReader<TcpStream>, status: u16, body: &[u8]) -> Result<()> {
    let head = format!("HTTP/1.1 {status} Response\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    reader.get_mut().write_all(head.as_bytes()).await?;
    reader.get_mut().write_all(body).await?;
    reader.get_mut().shutdown().await?;
    Ok(())
}

async fn serve(
    socket: TcpStream,
    tokens: [String; 2],
    senders: [watch::Sender<Option<Value>>; 2],
) -> Result<()> {
    let mut reader = BufReader::new(socket);
    let mut head = Vec::new();
    // BufReader keeps this byte-wise delimiter scan from issuing one syscall per byte.
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() >= MAX_HEADER_BYTES {
            return respond(&mut reader, 431, b"").await;
        }
        head.push(reader.read_u8().await?);
    }
    let head = std::str::from_utf8(&head)?;
    let mut lines = head.split("\r\n");
    let request: Vec<&str> = lines.next().unwrap_or("").split_whitespace().collect();
    if request.len() != 3 {
        return respond(&mut reader, 400, b"").await;
    }
    let mut length = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = Some(value.trim().parse::<usize>()?);
            }
            if name.eq_ignore_ascii_case("transfer-encoding") {
                return respond(&mut reader, 400, b"").await;
            }
        }
    }
    for (index, token) in tokens.iter().enumerate() {
        if request[0] == "GET" && request[1] == format!("/probe/{token}") {
            return respond(&mut reader, 200, page(token).as_bytes()).await;
        }
        if request[0] == "POST" && request[1] == format!("/report/{token}") {
            let Some(length) = length else {
                return respond(&mut reader, 411, b"").await;
            };
            if length > MAX_REPORT_BYTES {
                return respond(&mut reader, 413, b"").await;
            }
            let mut body = vec![0u8; length];
            reader.read_exact(&mut body).await?;
            let report: Value = serde_json::from_slice(&body)?;
            if !report.is_object() {
                return respond(&mut reader, 400, b"").await;
            }
            // Keep the first capture if a later navigation reloads the probe page.
            senders[index].send_if_modified(|value| {
                if value.is_some() {
                    false
                } else {
                    *value = Some(report);
                    true
                }
            });
            return respond(&mut reader, 204, b"").await;
        }
    }
    respond(&mut reader, 404, b"").await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn accepts_registered_reports_and_rejects_unknown_tokens_and_large_bodies() -> Result<()>
    {
        let server = ProbeServer::start().await?;
        let url = url::Url::parse(&server.reference_url)?;
        let address = format!("127.0.0.1:{}", url.port().unwrap());
        for (path, length, expected) in [
            (url.path().replace("/probe/", "/report/"), 2, "204"),
            ("/report/unknown".into(), 2, "404"),
            (
                url.path().replace("/probe/", "/report/"),
                MAX_REPORT_BYTES + 1,
                "413",
            ),
        ] {
            let mut socket = TcpStream::connect(&address).await?;
            socket
                .write_all(
                    format!("POST {path} HTTP/1.1\r\nContent-Length: {length}\r\n\r\n{{}}")
                        .as_bytes(),
                )
                .await?;
            let mut response = Vec::new();
            socket.read_to_end(&mut response).await?;
            assert!(String::from_utf8(response)?.starts_with(&format!("HTTP/1.1 {expected}")));
        }
        assert_eq!(
            server.report(true, Duration::from_secs(1)).await?,
            serde_json::json!({})
        );
        Ok(())
    }
}
