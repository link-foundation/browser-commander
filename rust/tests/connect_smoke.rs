//! Smoke test that starts a system Chrome with a dedicated CDP profile and
//! attaches every supported Rust engine. Run explicitly with:
//!
//! ```sh
//! BROWSER_COMMANDER_CHROME=/usr/bin/google-chrome \
//!   cargo test --test connect_smoke -- --ignored --nocapture
//! ```

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use browser_commander::{connect_browser, ConnectOptions};

#[tokio::test]
#[ignore]
async fn attach_all_cdp_engines_to_system_chrome() -> anyhow::Result<()> {
    let temporary_directory = tempdir()?;
    let chrome = std::env::var_os("BROWSER_COMMANDER_CHROME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/usr/bin/google-chrome"));
    let mut child = ChildGuard(
        Command::new(chrome)
            .arg("--remote-debugging-address=127.0.0.1")
            .arg("--remote-debugging-port=0")
            .arg(format!(
                "--user-data-dir={}",
                temporary_directory.path().display()
            ))
            .args([
                "--headless=new",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "about:blank",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?,
    );

    let endpoint = wait_for_endpoint(temporary_directory.path(), &mut child).await?;
    let node_working_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js");
    let options = [
        ConnectOptions::chromiumoxide()
            .cdp_endpoint(&endpoint)
            .timeout(Duration::from_secs(20)),
        ConnectOptions::playwright()
            .cdp_endpoint(&endpoint)
            .timeout(Duration::from_secs(20))
            .node_working_dir(&node_working_dir),
        ConnectOptions::puppeteer()
            .cdp_endpoint(&endpoint)
            .timeout(Duration::from_secs(20))
            .node_working_dir(&node_working_dir),
    ];

    for option in options {
        let engine = option.engine;
        let result = connect_browser(option).await?;
        result
            .page
            .goto("data:text/html,<h1 id=connected>attached</h1>")
            .await?;
        assert_eq!(
            result
                .page
                .evaluate("document.querySelector('#connected').textContent")
                .await?
                .as_str(),
            Some("attached"),
            "{engine} should operate through the shared page adapter"
        );
    }

    Ok(())
}

async fn wait_for_endpoint(profile: &Path, child: &mut ChildGuard) -> anyhow::Result<String> {
    let active_port = profile.join("DevToolsActivePort");
    for _ in 0..200 {
        if let Some(status) = child.0.try_wait()? {
            anyhow::bail!("Chrome exited before CDP was ready: {status}");
        }
        if let Ok(contents) = std::fs::read_to_string(&active_port) {
            if let Some(port) = contents.lines().next() {
                return Ok(format!("http://127.0.0.1:{port}"));
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    anyhow::bail!("timed out waiting for {}", active_port.display())
}

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

struct TempDir(PathBuf);

impl TempDir {
    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn tempdir() -> std::io::Result<TempDir> {
    let unique = format!(
        "bc-connect-smoke-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    );
    let path = std::env::temp_dir().join(unique);
    std::fs::create_dir_all(&path)?;
    Ok(TempDir(path))
}
