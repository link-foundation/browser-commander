//! Launch with the defaults and show that Chrome for Testing starts without
//! its "only for automated testing" infobar (issue #179).
//!
//! The infobar takes about 40px of the window, so the gap between
//! `outerHeight` and `innerHeight` grows by that much when it shows. Pass
//! `--keep-infobar` to opt out of the default restrictions and compare.
//!
//! Run with: `xvfb-run -a cargo run --example chrome_for_testing_default`

use browser_commander::{is_chrome_for_testing, launch_browser, LaunchOptions};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let keep_infobar = std::env::args().any(|arg| arg == "--keep-infobar");
    let mut options = LaunchOptions::chromiumoxide().headless(false);
    if keep_infobar {
        options = options.default_restrictions(Vec::<String>::new());
    }
    if std::env::var_os("CHROME_NO_SANDBOX").is_some() {
        options = options.sandbox(false);
    }

    let result = launch_browser(options).await?;
    let executable = result.executable_path.clone().unwrap_or_default();
    // Give the infobar time to appear before measuring.
    tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    let chrome_height = result
        .page
        .evaluate("outerHeight - innerHeight")
        .await?
        .as_i64();

    println!("executable: {}", executable.display());
    println!("chrome for testing: {}", is_chrome_for_testing(&executable));
    println!("default restrictions: {:?}", result.default_restrictions);
    println!(
        "test-type=gpu passed: {}",
        result.args.iter().any(|arg| arg == "--test-type=gpu")
    );
    println!("browser chrome height: {chrome_height:?}px");

    result.close().await?;
    Ok(())
}
