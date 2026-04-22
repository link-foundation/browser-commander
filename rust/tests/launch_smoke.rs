//! Smoke test that launches a real Chromium via `launch_browser` and exercises
//! the returned page adapter. Requires a working Chrome/Chromium installation
//! and is therefore marked `#[ignore]`; run explicitly with:
//!
//! ```sh
//! cargo test --test launch_smoke -- --ignored --nocapture
//! ```

use std::time::Duration;

use browser_commander::{launch_browser, LaunchOptions};

#[tokio::test]
#[ignore]
async fn launch_and_navigate() -> anyhow::Result<()> {
    let tmp = tempdir()?;
    let options = LaunchOptions::chromiumoxide()
        .headless(true)
        .sandbox(false)
        .user_data_dir(tmp.path())
        .with_args(vec!["--disable-dev-shm-usage".to_string()])
        .launch_timeout(Duration::from_secs(20));

    let result = launch_browser(options).await?;
    let page = result.page.clone();

    page.goto("data:text/html,<!doctype html><title>ok</title><h1 id=hi>hello</h1>")
        .await?;

    let url = page.url().await?;
    assert!(url.starts_with("data:"), "unexpected url: {url}");

    let content = page
        .evaluate("document.querySelector('#hi').textContent")
        .await?;
    assert_eq!(content.as_str(), Some("hello"));

    let visible = page.is_visible("#hi").await?;
    assert!(visible);

    let count = page.count("h1").await?;
    assert_eq!(count, 1);

    Ok(())
}

struct TempDir {
    path: std::path::PathBuf,
}

impl TempDir {
    fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

fn tempdir() -> std::io::Result<TempDir> {
    let base = std::env::temp_dir();
    let unique = format!(
        "bc-launch-smoke-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let path = base.join(unique);
    std::fs::create_dir_all(&path)?;
    Ok(TempDir { path })
}
