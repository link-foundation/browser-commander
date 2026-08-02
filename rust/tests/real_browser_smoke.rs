//! Smoke test for the installed-browser launch-and-connect lifecycle. Run with:
//!
//! ```sh
//! BROWSER_COMMANDER_CHROME=/usr/bin/google-chrome \
//!   cargo test --test real_browser_smoke -- --ignored --nocapture
//! ```

use std::path::PathBuf;
use std::time::Duration;

use browser_commander::{launch_real_browser, RealBrowserOptions};
use serde_json::json;

#[tokio::test]
#[ignore]
async fn launch_system_chrome_and_attach() -> anyhow::Result<()> {
    let temporary_directory = tempdir()?;
    let chrome = std::env::var_os("BROWSER_COMMANDER_CHROME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/usr/bin/google-chrome"));
    let mut result = launch_real_browser(
        RealBrowserOptions::chromiumoxide()
            .executable_path(chrome)
            .user_data_dir(temporary_directory.path())
            .headless(true)
            .verbose(true)
            .startup_timeout(Duration::from_secs(20))
            .with_args(vec![
                "--no-sandbox".to_string(),
                "--disable-dev-shm-usage".to_string(),
            ])
            .seed_cookies(vec![json!({
                "name": "attached",
                "value": "rust",
                "domain": ".example.com",
            })]),
    )
    .await?;

    result
        .page
        .goto("data:text/html,<main id=connected>Real browser connection works</main>")
        .await?;
    assert_eq!(result.page.count("#connected").await?, 1);
    result.browser_process.kill()?;
    Ok(())
}

struct TempDir(PathBuf);

impl TempDir {
    fn path(&self) -> &std::path::Path {
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
        "bc-real-browser-smoke-{}-{}",
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
