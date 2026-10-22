//! An engine launch without a channel or executable starts Chrome for
//! Testing, never the installed Google Chrome, and fantoccini drives it with
//! a chromedriver of its version rather than the one on `PATH` (issue #179).
//!
//! Run with: `cargo run --example engine_chrome_for_testing -- fantoccini`
//! (or `chromiumoxide`). Put an older `chromedriver` first on `PATH` to see
//! that it is not used.

use browser_commander::{is_chrome_for_testing, launch_browser, LaunchMode, LaunchOptions};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let engine = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "fantoccini".into());
    let options = match engine.as_str() {
        "chromiumoxide" => LaunchOptions::chromiumoxide(),
        _ => LaunchOptions::fantoccini(),
    }
    .launch(LaunchMode::Engine)
    .headless(true)
    .sandbox(std::env::var_os("CHROME_NO_SANDBOX").is_none());

    let result = launch_browser(options).await?;
    let executable = result.executable_path.clone().unwrap_or_default();
    let agent = result.page.evaluate("navigator.userAgent").await?;
    println!("engine: {engine}");
    println!("executable: {}", executable.display());
    println!("chrome for testing: {}", is_chrome_for_testing(&executable));
    println!("default restrictions: {:?}", result.default_restrictions);
    println!("user agent: {agent}");
    result.close().await?;
    Ok(())
}
