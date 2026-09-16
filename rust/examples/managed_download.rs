//! Download a file with a real browser and keep it (issue #88).
//!
//! The unit tests stage files by hand, so they prove the manager's rules but
//! not that Chromium actually redirects its downloads. This drives a real
//! browser: it clicks a link, waits for the download, and then closes the
//! browser and reads the file back — which is the whole promise of a managed
//! download.
//!
//! Run with: `cargo run --example managed_download`
//! Add `CHROME_NO_SANDBOX=true` on hosts where the Chromium sandbox is
//! unavailable.

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::process::ExitCode;
use std::time::Duration;

use browser_commander::browser::{launch_browser, LaunchOptions};
use browser_commander::downloads::{CaptureOptions, DownloadOptions};
use browser_commander::interactions::click_element;

/// The file the page offers, small enough to print back in full.
const REPORT: &[u8] = b"%PDF-1.7 a small but real file";

/// Serve the page and the file it links to, on a port the OS picks.
///
/// A `file://` page would need no server, but Chromium honours the `download`
/// attribute only for same-origin links and every `file://` document has its
/// own opaque origin, so the link would be *navigated* instead of downloaded
/// and nothing would ever reach the staging directory.
fn serve() -> std::io::Result<u16> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut request = String::new();
            if BufReader::new(&stream).read_line(&mut request).is_err() {
                continue;
            }
            let path = request.split_whitespace().nth(1).unwrap_or("/");
            let _ = stream.write_all(&response_for(path));
            let _ = stream.flush();
        }
    });

    Ok(port)
}

/// The bytes to answer one request with.
fn response_for(path: &str) -> Vec<u8> {
    if path.starts_with("/report.pdf") {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/pdf\r\n\
             Content-Disposition: attachment; filename=\"report.pdf\"\r\n\
             Content-Length: {}\r\nConnection: close\r\n\r\n",
            REPORT.len()
        )
        .into_bytes();
        response.extend_from_slice(REPORT);
        return response;
    }

    let page = "<!doctype html><title>download</title>\
                <a id=\"get\" href=\"/report.pdf\" download=\"report.pdf\">get the report</a>";
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\n\
         Connection: close\r\n\r\n{page}",
        page.len()
    )
    .into_bytes()
}

#[tokio::main]
async fn main() -> ExitCode {
    let port = match serve() {
        Ok(port) => port,
        Err(error) => {
            eprintln!("could not serve the example site: {error}");
            return ExitCode::FAILURE;
        }
    };
    let downloads =
        std::env::temp_dir().join(format!("bc-download-example-{}", std::process::id()));

    let result = run(&format!("http://127.0.0.1:{port}/"), &downloads).await;
    let _ = std::fs::remove_dir_all(&downloads);

    match result {
        Ok(report) => {
            println!("{report}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

/// Launch, download, close, and then read the file back.
async fn run(url: &str, downloads: &std::path::Path) -> anyhow::Result<String> {
    let launched = launch_browser(
        LaunchOptions::chromiumoxide()
            .headless(true)
            .sandbox(std::env::var("CHROME_NO_SANDBOX").is_err())
            .downloads(DownloadOptions::default().directory(downloads.to_string_lossy())),
    )
    .await?;
    let manager = launched
        .downloads
        .clone()
        .ok_or_else(|| anyhow::anyhow!("the launcher returned no download manager"))?;
    let page = launched.page.clone();

    page.goto(url).await?;
    let artifact = manager
        .capture(
            CaptureOptions::named("the-report.pdf").within(Duration::from_secs(20)),
            async {
                click_element(page.as_ref(), "#get", &Default::default()).await?;
                Ok(())
            },
        )
        .await?;

    let path = artifact
        .path
        .clone()
        .ok_or_else(|| anyhow::anyhow!("a completed download has a path"))?;

    // Everything that produced the file is gone before the file is read: a
    // download that only exists while the browser is open is not a download.
    manager.dispose().await;
    drop(launched);
    tokio::time::sleep(Duration::from_millis(250)).await;

    let contents = std::fs::read(&path)?;
    Ok(format!(
        "saved {} ({} bytes, sha256 {}…)\n\
         the page suggested {:?}, the caller asked for {:?}\n\
         after the browser closed it still reads: {}",
        path.display(),
        artifact.bytes.unwrap_or_default(),
        &artifact.checksum.unwrap_or_default()[..12],
        artifact.suggested_filename.unwrap_or_default(),
        path.file_name().unwrap_or_default(),
        String::from_utf8_lossy(&contents)
    ))
}
