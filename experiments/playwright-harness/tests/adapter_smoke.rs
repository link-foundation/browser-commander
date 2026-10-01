//! Drives a real browser through `PlaywrightDriverPage`, the engine adapter.
//! Skipped unless PW_SMOKE_EXECUTABLE names a Chromium binary.

use playwright_harness::browser::playwright_driver_page::{
    PlaywrightConnect, PlaywrightDriverPage, PlaywrightLaunch,
};
use playwright_harness::core::engine::{EngineAdapter, EngineError, PdfOptions};
use playwright_harness::playwright::DriverOptions;
use serde_json::json;

fn driver_options() -> DriverOptions {
    DriverOptions {
        working_dir: Some(concat!(env!("CARGO_MANIFEST_DIR"), "/../../js").into()),
        verbose: true,
        ..DriverOptions::default()
    }
}

const PAGE: &str = "data:text/html,<title>t</title>\
<h1 id=x>Hello</h1><input id=i value=start><button id=b disabled>B</button>\
<p id=hidden style=display:none>h</p><a id=a href=/x data-k=v>link</a>";

#[tokio::test]
async fn the_adapter_drives_a_launched_browser() {
    let Ok(executable) = std::env::var("PW_SMOKE_EXECUTABLE") else {
        eprintln!("PW_SMOKE_EXECUTABLE is not set; skipping");
        return;
    };
    let profile = std::env::temp_dir().join(format!("pw-adapter-{}", std::process::id()));
    let page = PlaywrightDriverPage::launch(PlaywrightLaunch {
        driver: driver_options(),
        user_data_dir: profile.clone(),
        headless: true,
        executable_path: Some(executable.into()),
        color_scheme: Some("dark".into()),
        ..Default::default()
    })
    .await
    .expect("launch");

    page.goto(PAGE).await.expect("goto");
    assert!(page.url().await.unwrap().starts_with("data:text/html"));
    page.wait_for_navigation(1_000)
        .await
        .expect("already loaded");

    let heading = page.query_selector("#x").await.unwrap().expect("heading");
    assert_eq!(heading.tag_name, "H1");
    assert!(heading.is_visible && heading.bounding_box.is_some());
    assert!(page.query_selector("#none").await.unwrap().is_none());
    assert_eq!(page.query_selector_all("h1, p").await.unwrap().len(), 2);
    assert_eq!(page.count("input").await.unwrap(), 1);
    assert!(!page.is_visible("#hidden").await.unwrap());
    assert!(!page.is_enabled("#b").await.unwrap());
    assert_eq!(
        page.get_attribute("#a", "data-k").await.unwrap().as_deref(),
        Some("v")
    );
    assert_eq!(
        page.text_content("#x").await.unwrap().as_deref(),
        Some("Hello")
    );

    page.fill("#i", "filled").await.unwrap();
    page.type_text("#i", "!").await.unwrap();
    assert_eq!(
        page.input_value("#i").await.unwrap().as_deref(),
        Some("filled!")
    );
    page.keyboard_press("Backspace").await.unwrap();
    assert_eq!(
        page.input_value("#i").await.unwrap().as_deref(),
        Some("filled")
    );

    assert_eq!(
        page.evaluate("() => ({ n: 1 + 1, u: undefined, s: [1.5] })")
            .await
            .unwrap(),
        json!({ "n": 2, "u": null, "s": [1.5] })
    );
    assert_eq!(page.evaluate("6 * 7").await.unwrap(), json!(42));
    assert_eq!(
        page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches")
            .await
            .unwrap(),
        json!(true)
    );
    let error = page.evaluate("(() => { throw new Error('boom') })()").await;
    assert!(matches!(error, Err(EngineError::Browser(ref m)) if m.contains("boom")));

    let timeout = page.wait_for_selector("#never", 300).await;
    assert!(
        matches!(timeout, Err(EngineError::Timeout(_))),
        "{timeout:?}"
    );
    page.wait_for_selector("#x", 1_000).await.unwrap();
    page.scroll_into_view("#x").await.unwrap();
    page.click("#x").await.unwrap();

    let png = page.screenshot().await.unwrap();
    assert_eq!(&png[1..4], b"PNG");
    let pdf = page
        .pdf(PdfOptions {
            margin_top: Some("1cm".into()),
            ..Default::default()
        })
        .await
        .unwrap();
    assert_eq!(&pdf[..4], b"%PDF");

    let version = page.read_browser_version_page().await.unwrap();
    assert!(version["commandLine"].as_str().unwrap().contains("--"));

    page.goto("about:blank").await.unwrap();
    page.restore_storage_state(json!({
        "cookies": [{ "name": "c", "value": "1", "url": "https://example.com/" }],
        "origins": [],
    }))
    .await
    .unwrap();
    let state = page.export_storage_state().await.unwrap();
    assert!(state["cookies"]
        .as_array()
        .unwrap()
        .iter()
        .any(|cookie| cookie["name"] == "c"));

    page.close().await.expect("close");
    let _ = std::fs::remove_dir_all(&profile);
}

#[tokio::test]
async fn the_adapter_attaches_over_cdp() {
    let Ok(executable) = std::env::var("PW_SMOKE_EXECUTABLE") else {
        eprintln!("PW_SMOKE_EXECUTABLE is not set; skipping");
        return;
    };
    let profile = std::env::temp_dir().join(format!("pw-adapter-cdp-{}", std::process::id()));
    let port = 9_400 + (std::process::id() % 500) as u16;
    let mut chrome = std::process::Command::new(executable)
        .args([
            "--headless=new",
            "--no-sandbox",
            &format!("--remote-debugging-port={port}"),
            &format!("--user-data-dir={}", profile.display()),
            "data:text/html,<title>attached</title>",
        ])
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("chrome starts");

    let endpoint = format!("http://127.0.0.1:{port}");
    let mut attached = None;
    for _ in 0..50 {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        if let Ok(page) = PlaywrightDriverPage::connect(PlaywrightConnect {
            driver: driver_options(),
            endpoint: endpoint.clone(),
            seed_cookies: vec![
                json!({ "name": "seed", "value": "1", "url": "https://example.com/" }),
            ],
            color_scheme: Some("dark".into()),
            ..Default::default()
        })
        .await
        {
            attached = Some(page);
            break;
        }
    }
    let page = attached.expect("connectOverCDP");
    assert_eq!(
        page.evaluate("document.title").await.unwrap(),
        json!("attached")
    );
    let state = page.export_storage_state().await.unwrap();
    assert!(state["cookies"]
        .as_array()
        .unwrap()
        .iter()
        .any(|cookie| cookie["name"] == "seed"));
    page.close().await.expect("disconnect");

    // Disconnecting leaves the browser running.
    assert!(chrome.try_wait().unwrap().is_none());
    chrome.kill().unwrap();
    let _ = chrome.wait();
    let _ = std::fs::remove_dir_all(&profile);
}
