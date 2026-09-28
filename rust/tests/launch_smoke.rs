//! Smoke tests that launch a real Chromium via `launch_browser`, in both
//! launch modes, and exercise the returned page adapter. They require a
//! working Chrome/Chromium installation and are therefore marked `#[ignore]`;
//! run explicitly with:
//!
//! ```sh
//! cargo test --test launch_smoke -- --ignored --nocapture
//! ```

use std::time::Duration;

use browser_commander::{launch_browser, ColorScheme, EngineAdapter, LaunchMode, LaunchOptions};

fn options(launch: LaunchMode) -> LaunchOptions {
    LaunchOptions::chromiumoxide()
        .launch(launch)
        .headless(true)
        .sandbox(false)
        .with_args(vec!["--disable-dev-shm-usage".to_string()])
        .launch_timeout(Duration::from_secs(20))
        .color_scheme(ColorScheme::Dark)
}

async fn exercise(page: &dyn EngineAdapter) -> anyhow::Result<()> {
    // Every launch here asks for a dark color scheme.
    assert_eq!(
        page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches")
            .await?
            .as_bool(),
        Some(true),
        "the color scheme was not applied"
    );
    page.goto("data:text/html,<!doctype html><title>ok</title><h1 id=hi>hello</h1>")
        .await?;

    let url = page.url().await?;
    assert!(url.starts_with("data:"), "unexpected url: {url}");

    let content = page
        .evaluate("document.querySelector('#hi').textContent")
        .await?;
    assert_eq!(content.as_str(), Some("hello"));

    assert!(page.is_visible("#hi").await?);
    assert_eq!(page.count("h1").await?, 1);
    Ok(())
}

#[tokio::test]
#[ignore]
async fn real_launch_is_the_default_and_close_removes_the_profile() -> anyhow::Result<()> {
    assert_eq!(LaunchOptions::chromiumoxide().launch, LaunchMode::Real);
    let result = launch_browser(options(LaunchMode::Real)).await?;

    assert_eq!(result.launch, Some(LaunchMode::Real));
    assert!(result.temporary_profile);
    assert!(result.browser.user_data_dir.is_dir());
    assert!(result.cdp_endpoint.is_some());
    assert!(result.remote_debugging_port.is_some());
    assert!(result.executable_path.is_some());
    let process = result
        .browser_process
        .clone()
        .expect("a real launch owns its process");
    assert!(process.is_running());
    // The browser was started by hand, so the page is not a webdriver page.
    assert_eq!(
        result.page.evaluate("navigator.webdriver").await?.as_bool(),
        Some(false)
    );
    exercise(result.page.as_ref()).await?;

    result.close().await?;
    result.close().await?;
    assert!(!process.is_running());
    assert!(!result.browser.user_data_dir.exists());
    Ok(())
}

#[tokio::test]
#[ignore]
async fn engine_launch_uses_a_temporary_profile_and_close_removes_it() -> anyhow::Result<()> {
    let result = launch_browser(options(LaunchMode::Engine)).await?;

    assert_eq!(result.launch, Some(LaunchMode::Engine));
    assert!(result.temporary_profile);
    assert!(result.browser.user_data_dir.is_dir());
    assert!(result.browser_process.is_none());
    exercise(result.page.as_ref()).await?;

    result.close().await?;
    assert!(!result.browser.user_data_dir.exists());
    Ok(())
}

#[tokio::test]
#[ignore]
async fn a_given_profile_is_kept() -> anyhow::Result<()> {
    let tmp = tempdir()?;
    let result = launch_browser(options(LaunchMode::Real).user_data_dir(tmp.path())).await?;

    assert!(!result.temporary_profile);
    assert_eq!(result.browser.user_data_dir, tmp.path());
    exercise(result.page.as_ref()).await?;

    result.close().await?;
    assert!(tmp.path().is_dir());
    Ok(())
}

/// Where Node resolves `playwright` and `puppeteer`
/// (`BROWSER_COMMANDER_NODE_DIR`, the JS package by default).
fn node_working_dir() -> std::path::PathBuf {
    std::env::var_os("BROWSER_COMMANDER_NODE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js"))
}

#[tokio::test]
#[ignore]
async fn node_engines_launch_in_both_modes() -> anyhow::Result<()> {
    for engine in [LaunchOptions::playwright(), LaunchOptions::puppeteer()] {
        for launch in [LaunchMode::Real, LaunchMode::Engine] {
            let options = engine
                .clone()
                .launch(launch)
                .headless(true)
                .sandbox(false)
                // The installed Chrome, so no engine download is needed.
                .channel("chrome")
                .color_scheme(ColorScheme::Dark)
                .node_working_dir(node_working_dir())
                .env(std::collections::HashMap::from([(
                    "TZ".to_string(),
                    "Asia/Tokyo".to_string(),
                )]));
            let result = launch_browser(options).await?;
            let label = format!("{} {launch}", result.browser.engine);

            assert_eq!(result.launch, Some(launch), "{label}");
            assert!(result.temporary_profile, "{label}");
            exercise(result.page.as_ref()).await?;
            // The environment reaches the browser only.
            assert_eq!(
                result
                    .page
                    .evaluate("Intl.DateTimeFormat().resolvedOptions().timeZone")
                    .await?
                    .as_str(),
                Some("Asia/Tokyo"),
                "{label}"
            );
            assert_ne!(std::env::var("TZ").ok().as_deref(), Some("Asia/Tokyo"));
            if launch == LaunchMode::Real {
                assert_eq!(
                    result.page.evaluate("navigator.webdriver").await?.as_bool(),
                    Some(false),
                    "{label}"
                );
            }

            result.close().await?;
            assert!(!result.browser.user_data_dir.exists(), "{label}");
        }
    }
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
