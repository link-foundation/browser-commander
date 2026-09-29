//! Run with `cargo test --test storage_state_smoke -- --ignored --nocapture`.
//! Requires Chrome and the Playwright/Puppeteer packages in ../js.

use std::path::PathBuf;

use browser_commander::{
    launch_browser, save_storage_state, LaunchMode, LaunchOptions, StorageStateInput,
};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;

fn node_working_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js")
}

#[tokio::test]
#[ignore]
async fn transfers_cookies_and_local_storage_across_three_engines() -> anyhow::Result<()> {
    // feature-parity: storage.portable@native-typed
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let server = tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let _ = socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 11\r\nConnection: close\r\n\r\n<h1>ok</h1>")
                    .await;
            });
        }
    });

    let path = std::env::temp_dir().join(format!(
        "bc-storage-state-smoke-{}-{}.json",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_nanos()
    ));

    let source = launch_browser(
        LaunchOptions::chromiumoxide()
            .launch(LaunchMode::Engine)
            .headless(true)
            .sandbox(false)
            .executable_path("/usr/bin/google-chrome"),
    )
    .await?;
    source.page.goto(&origin).await?;
    source
        .page
        .evaluate("localStorage.setItem('theme', 'dark'); document.cookie = 'sid=saved; path=/'")
        .await?;
    let state = save_storage_state(source.page.as_ref(), Some(&path)).await?;
    assert_eq!(state.origins.len(), 1);
    assert!(state.cookies.iter().any(|cookie| cookie["name"] == "sid"));
    source.close().await?;

    for options in [
        LaunchOptions::chromiumoxide().executable_path("/usr/bin/google-chrome"),
        LaunchOptions::playwright(),
        LaunchOptions::puppeteer(),
    ] {
        for mode in [LaunchMode::Real, LaunchMode::Engine] {
            let result = launch_browser(
                options
                    .clone()
                    .launch(mode)
                    .headless(true)
                    .sandbox(false)
                    .channel("chrome")
                    .node_working_dir(node_working_dir())
                    .storage_state(StorageStateInput::Path(path.clone())),
            )
            .await?;
            result.page.goto(&origin).await?;
            assert_eq!(
                result
                    .page
                    .evaluate("localStorage.getItem('theme')")
                    .await?
                    .as_str(),
                Some("dark"),
                "{} {mode}",
                result.browser.engine
            );
            assert!(
                result
                    .page
                    .evaluate("document.cookie")
                    .await?
                    .as_str()
                    .unwrap_or_default()
                    .contains("sid=saved"),
                "{} {mode}",
                result.browser.engine
            );
            save_storage_state(result.page.as_ref(), Some(&path)).await?;
            result.close().await?;
        }
    }

    std::fs::remove_file(path)?;
    server.abort();
    Ok(())
}
