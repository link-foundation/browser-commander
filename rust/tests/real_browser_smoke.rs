//! Smoke tests for the installed-browser launch-and-connect lifecycle. They
//! start a real Chrome, so they are ignored by default. Run with:
//!
//! ```sh
//! BROWSER_COMMANDER_CHROME=/usr/bin/google-chrome \
//!   xvfb-run -a cargo test --test real_browser_smoke -- --ignored --nocapture
//! ```
//!
//! The headful test needs a display (`xvfb-run` provides one on Linux).

use std::path::PathBuf;
use std::time::Duration;

use browser_commander::{launch_real_browser, RealBrowserOptions};
use serde_json::json;

fn chrome() -> PathBuf {
    std::env::var_os("BROWSER_COMMANDER_CHROME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/usr/bin/google-chrome"))
}

#[tokio::test]
#[ignore]
async fn launch_system_chrome_and_attach() -> anyhow::Result<()> {
    let result = launch_real_browser(
        RealBrowserOptions::chromiumoxide()
            .executable_path(chrome())
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

    assert!(result.temporary_profile);
    assert_ne!(result.remote_debugging_port, 0);
    result
        .page
        .goto("data:text/html,<main id=connected>Real browser connection works</main>")
        .await?;
    assert_eq!(result.page.count("#connected").await?, 1);
    // Headless needs no off switch either (issue #103, measured).
    assert!(!result
        .args
        .iter()
        .any(|argument| argument.contains("AutomationControlled")));
    assert_eq!(
        result.page.evaluate("navigator.webdriver").await?,
        json!(false)
    );

    let profile = result.user_data_dir.clone();
    result.close().await?;
    assert!(!result.browser_process.is_running());
    assert!(!profile.exists(), "temporary profile was not removed");
    Ok(())
}

/// Issue #101: a headful launch on a fixed port has nothing on its command
/// line that turns `AutomationControlled` on, so `navigator.webdriver` is
/// false without any off switch.
#[tokio::test]
#[ignore]
async fn headful_launch_keeps_navigator_webdriver_false() -> anyhow::Result<()> {
    let result = launch_real_browser(
        RealBrowserOptions::chromiumoxide()
            .executable_path(chrome())
            .startup_timeout(Duration::from_secs(20)),
    )
    .await?;

    assert_eq!(
        result.args,
        [
            format!("--user-data-dir={}", result.user_data_dir.display()),
            format!("--remote-debugging-port={}", result.remote_debugging_port),
        ]
    );
    result
        .page
        .goto("data:text/html,<main>webdriver</main>")
        .await?;
    let webdriver = result.page.evaluate("navigator.webdriver").await?;
    println!("navigator.webdriver = {webdriver}");
    assert_eq!(webdriver, json!(false));

    result.close().await?;
    Ok(())
}
