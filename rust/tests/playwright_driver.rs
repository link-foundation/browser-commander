//! Rust Playwright through the official driver, with typed protocol calls
//! (issue #108), and the Node bridge as the fallback when no matching driver
//! is installed. Real Chrome; run with `--ignored`.

use std::path::PathBuf;
use std::time::Duration;

use browser_commander::playwright::protocol::{
    BrowserContextCookiesParams, PageSetViewportSizeParams, PageSetViewportSizeParamsViewportSize,
};
use browser_commander::playwright::{DriverLocation, DriverOptions, PlaywrightDriver, DRIVER_ENV};
use browser_commander::{
    launch_browser, EngineAdapter, EngineType, LaunchOptions, PlaywrightDriverPage,
    PlaywrightLaunch,
};
use serde_json::json;

/// Both tests start drivers under this process, and the second one checks
/// which kind of process it started.
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn js_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js")
}

fn profile(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "bc-playwright-driver-{name}-{}",
        std::process::id()
    ))
}

/// Whether a process descended from this one has `needle` in its command line.
#[cfg(target_os = "linux")]
fn owns_process(needle: &str) -> bool {
    let parent = |pid: &str| -> Option<String> {
        let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
        status
            .lines()
            .find_map(|line| line.strip_prefix("PPid:"))
            .map(|ppid| ppid.trim().to_string())
    };
    let me = std::process::id().to_string();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return false;
    };
    entries.flatten().any(|entry| {
        let pid = entry.file_name().to_string_lossy().into_owned();
        let Ok(cmdline) = std::fs::read(entry.path().join("cmdline")) else {
            return false;
        };
        if !String::from_utf8_lossy(&cmdline).contains(needle) {
            return false;
        }
        let mut current = parent(&pid);
        while let Some(pid) = current {
            if pid == me {
                return true;
            }
            if pid == "0" || pid == "1" {
                return false;
            }
            current = parent(&pid);
        }
        false
    })
}

// feature-parity: engine.playwright@native-typed
#[tokio::test]
#[ignore]
async fn the_official_driver_runs_the_typed_playwright_api() -> anyhow::Result<()> {
    let cli = js_dir().join("node_modules/playwright-core/cli.js");
    // `at` refuses a driver whose protocol differs from the bindings.
    let location = DriverLocation::at(&cli)?;
    let _serial = SERIAL.lock().await;
    let driver = PlaywrightDriver::launch_at(location, DriverOptions::default()).await?;
    let user_data_dir = profile("typed");
    let page = PlaywrightDriverPage::launch_with(
        driver,
        PlaywrightLaunch {
            user_data_dir: user_data_dir.clone(),
            headless: true,
            channel: Some("chrome".into()),
            ..Default::default()
        },
    )
    .await?;
    let result = async {
        page.goto("data:text/html,<title>typed</title><input id=i>")
            .await?;
        page.fill("#i", "native").await?;
        assert_eq!(page.input_value("#i").await?.as_deref(), Some("native"));

        // Everything else in Playwright is one typed call away.
        let (_, context, typed_page, _) = page.objects();
        typed_page
            .set_viewport_size(PageSetViewportSizeParams {
                viewport_size: PageSetViewportSizeParamsViewportSize {
                    width: 640,
                    height: 480,
                },
            })
            .await?;
        assert_eq!(page.evaluate("innerWidth").await?, json!(640));
        let cookies = context
            .cookies(BrowserContextCookiesParams { urls: Vec::new() })
            .await?;
        assert!(cookies.cookies.is_empty());
        anyhow::Ok(())
    }
    .await;
    page.close().await?;
    let _ = std::fs::remove_dir_all(&user_data_dir);
    result
}

/// `launch_browser` picks the driver for Playwright and falls back to the
/// Node bridge when the configured driver does not exist.
#[tokio::test]
#[ignore]
async fn launch_browser_prefers_the_driver_and_falls_back_to_the_bridge() -> anyhow::Result<()> {
    let _serial = SERIAL.lock().await;
    let launch = |name: &str| {
        LaunchOptions::default()
            .engine(EngineType::Playwright)
            .headless(true)
            .sandbox(false)
            .channel("chrome")
            .node_working_dir(js_dir())
            .user_data_dir(profile(name))
    };
    for (name, driver) in [("driver", None), ("bridge", Some("/nonexistent/cli.js"))] {
        match driver {
            Some(path) => std::env::set_var(DRIVER_ENV, path),
            None => std::env::remove_var(DRIVER_ENV),
        }
        let session =
            tokio::time::timeout(Duration::from_secs(120), launch_browser(launch(name))).await??;
        std::env::remove_var(DRIVER_ENV);
        let page = &session.page;
        page.goto("data:text/html,<title>launched</title>").await?;
        assert_eq!(page.evaluate("document.title").await?, json!("launched"));
        #[cfg(target_os = "linux")]
        assert_eq!(
            owns_process("run-driver"),
            driver.is_none(),
            "{name}: the driver runs only when it is available"
        );
        session.close().await?;
        let _ = std::fs::remove_dir_all(profile(name));
    }
    Ok(())
}
