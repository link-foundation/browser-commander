//! Complete typed Playwright through the official command-stream-owned driver.
use browser_commander::browser::playwright_driver::{launch_playwright, PlaywrightDriverOptions};
use std::time::Duration;

#[test]
fn typed_protocol_covers_the_pinned_driver() {
    use browser_commander::browser::playwright_driver::generated::{
        COMMAND_COUNT, PROTOCOL_VERSION,
    };
    let coverage: serde_json::Value = serde_json::from_str(include_str!(
        "../src/browser/playwright_driver/generated/coverage.json"
    ))
    .unwrap();
    assert_eq!(PROTOCOL_VERSION, "1.63.0");
    assert_eq!(coverage["version"], PROTOCOL_VERSION);
    assert_eq!(
        coverage["commands"].as_array().unwrap().len(),
        COMMAND_COUNT
    );
    assert_eq!(COMMAND_COUNT, 320);
    // Required wire fields and channel references have actual Rust types.
    let params: browser_commander::browser::playwright_driver::generated::browser_type::launch_persistent_context_params::LaunchPersistentContextParams=serde_json::from_value(serde_json::json!({"userDataDir":"/tmp/profile", "headless":true, "chromiumSandbox":false})).unwrap();
    assert_eq!(params.headless, Some(true));
    assert!(serde_json::from_value::<browser_commander::browser::playwright_driver::generated::browser_type::launch_persistent_context_params::LaunchPersistentContextParams>(serde_json::json!({"userDataDir":"x","headless":"true"})).is_err());
}

#[tokio::test]
#[ignore = "requires installed Chrome"]
async fn common_launcher_uses_native_playwright_in_both_modes() -> anyhow::Result<()> {
    use browser_commander::{launch_browser, LaunchMode, LaunchOptions};
    tokio::time::timeout(Duration::from_secs(60), async {
        for mode in [LaunchMode::Real, LaunchMode::Engine] {
            let output = browser_commander::browser::create_temporary_user_data_dir(None)?;
            let options = LaunchOptions::playwright()
                .launch(mode)
                .headless(true)
                .sandbox(false)
                .executable_path(std::env::var("CHROME_PATH")?)
                .fingerprint(browser_commander::fingerprint::create_default_fingerprint_preset("windows-chrome")?)
                .downloads(browser_commander::downloads::DownloadOptions::default().directory(output.to_string_lossy()));
            let result = launch_browser(options).await?;
            let typed = result.page.as_playwright().expect("default driver exposes its full typed page");
            assert!(!typed.driver().client().chromium().guid().is_empty());
            let profile = result.browser.user_data_dir.clone();
            result
                .page
                .goto("data:text/html,<title>native common API</title><input id='name'>")
                .await?;
            result.page.fill("#name", "native").await?;
            assert_eq!(typed.raw_page().title().await?, "native common API");
            assert_eq!(
                result.page.input_value("#name").await?,
                Some("native".into())
            );
            assert_eq!(result.page.evaluate("navigator.webdriver").await?, false);
            let saved = result.downloads.as_ref().unwrap().capture(
                    browser_commander::downloads::CaptureOptions::named("native.txt"),
                async {
                    result.page.evaluate("(() => { const a = document.createElement('a'); a.href=URL.createObjectURL(new Blob(['native download'])); a.download='native.txt'; document.body.append(a); a.click(); })()").await?;
                    Ok::<_, anyhow::Error>(())
                },
            ).await?;
            assert_eq!(std::fs::read_to_string(saved.path.as_ref().unwrap())?, "native download");
            let metadata = result.page.read_browser_version_page().await?;
            assert!(metadata["commandLine"]
                .as_str()
                .unwrap()
                .contains("--user-data-dir"));
            result.close().await?;
            assert!(!profile.exists());
            std::fs::remove_dir_all(output)?;
        }
        Ok::<_, anyhow::Error>(())
    })
    .await?
}

#[tokio::test]
async fn rejects_a_missing_driver_without_starting_a_browser() {
    let result = launch_playwright(PlaywrightDriverOptions {
        node_executable: Some("/nonexistent/browser-commander/playwright-node".into()),
        cli_script: Some("/nonexistent/browser-commander/playwright-cli.js".into()),
        ..Default::default()
    })
    .await;
    assert!(result.is_err());
}

#[tokio::test]
#[ignore = "requires the bundled official driver and installed Chrome"]
async fn full_typed_playwright_without_the_npm_cli() -> anyhow::Result<()> {
    tokio::time::timeout(Duration::from_secs(60), async {
        let driver = launch_playwright(PlaywrightDriverOptions::default()).await?;
        let pid = driver.driver_pid().unwrap();
        let chromium = driver.client().chromium();
        let mut options = playwright_rs::LaunchOptions::default();
        options.executable_path = Some(std::env::var("CHROME_PATH")?);
        options.headless = Some(true);
        options.args = Some(vec!["--no-sandbox".into()]);
        let browser = chromium.launch_with_options(options).await?;
        let context = browser.new_context().await?;
        let page = context.new_page().await?;
        page.goto(
            "data:text/html,<title>typed-driver</title><input id='name'>",
            None,
        )
        .await?;
        page.locator("#name")
            .fill("complete typed API", None)
            .await?;
        assert_eq!(
            page.locator("#name").input_value(None).await?,
            "complete typed API"
        );
        assert_eq!(page.title().await?, "typed-driver");
        browser.close().await?;
        driver.close().await?;
        if cfg!(target_os = "linux") {
            assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
        }
        Ok::<_, anyhow::Error>(())
    })
    .await?
}
