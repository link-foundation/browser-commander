//! Authored local pages and artificial cookies exercise native and bridge APIs.
// feature-parity: elements.reusable@native-typed sessions.runtime@native-typed sessions.workflow@native-typed
use std::{path::PathBuf, time::Duration};

use browser_commander::browser::profile_directory::{
    create_temporary_user_data_dir, remove_user_data_dir,
};
use browser_commander::high_level::install_click_listener;
use browser_commander::interactions::{
    click::click_button, click::ClickOptions, scroll::scroll_into_view, scroll::ScrollOptions,
};
use browser_commander::{
    check, clear_cookies, find_first, has_text, is_checked, is_enabled_at, launch_browser,
    read_flag, save_storage_state, set_cookies, uninstall_click_listener, FlagRead, LaunchMode,
    LaunchOptions,
};
use browser_commander::{find_site_sessions, EngineType, RealBrowserOptions, SessionSource};
use serde_json::json;
use tokio::{io::AsyncWriteExt, net::TcpListener};

#[tokio::test]
#[ignore = "requires Chromium and native Playwright; exercised by parity CI"]
async fn native_playwright_navigation_forwards_the_driver_timeout() -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let server = tokio::spawn(async move {
        let mut connections = Vec::new();
        while let Ok((socket, _)) = listener.accept().await {
            connections.push(socket);
        }
    });
    let executable = std::env::var_os("CHROME_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| "/usr/bin/google-chrome".into());
    let work = async {
        let launched = launch_browser(
            LaunchOptions::playwright()
                .launch(LaunchMode::Engine)
                .headless(true)
                .sandbox(false)
                .executable_path(executable)
                .node_working_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js")),
        )
        .await?;
        // Call the adapter directly: an outer goto budget would hide a missing
        // timeout in the Playwright driver's request metadata.
        let observed = tokio::time::timeout(
            Duration::from_millis(1500),
            launched
                .page
                .goto_with_options(&origin, "domcontentloaded", 150),
        )
        .await;
        let closed = launched.close().await;
        assert!(
            observed.is_ok(),
            "native Playwright ignored the 150 ms driver timeout"
        );
        assert!(
            observed.unwrap().is_err(),
            "stalled navigation must time out"
        );
        closed?;
        Ok::<_, anyhow::Error>(())
    };
    let observed = tokio::time::timeout(Duration::from_secs(30), work).await;
    server.abort();
    let _ = server.await;
    observed??;
    Ok(())
}

#[tokio::test]
#[ignore = "requires Chromium and JS engine packages; exercised by parity CI"]
async fn reusable_helpers_and_session_cookies_across_three_engines() -> anyhow::Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let server = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let html = "<p>Hello&nbsp;  world</p><button class='pick disabled'>No</button><button class='pick'>Yes</button><input type='checkbox' id='check'><input type='radio' id='radio'><div hidden id='hidden'>Hidden</div>";
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}", html.len());
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                socket.write_all(response.as_bytes()),
            )
            .await;
        }
    });
    let executable = std::env::var_os("CHROME_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| "/usr/bin/google-chrome".into());
    let checks = tokio::time::timeout(Duration::from_secs(120), async {
        for options in [LaunchOptions::chromiumoxide(), LaunchOptions::playwright(), LaunchOptions::puppeteer()] {
            eprintln!("Reusable session acceptance: {:?}", options.engine);
            let result = launch_browser(options.launch(LaunchMode::Engine)
                .headless(true).sandbox(false).executable_path(&executable)
                .node_working_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js"))).await?;
            let observed: anyhow::Result<()> = async {
                let page = result.page.as_ref();
                let started = std::time::Instant::now();
                let navigation = browser_commander::browser::goto(page, &origin, &browser_commander::browser::NavigationOptions {
                    timeout: Duration::from_secs(2), verify: false,
                    wait_for_stable_url_before: false, wait_for_stable_url_after: false,
                    ..Default::default()
                }).await?;
                assert!(navigation.navigated);
                assert!(started.elapsed() < Duration::from_secs(3));
                assert_eq!(find_first(page, &["#absent", "#hidden", "#check"], true).await?, Some("#check".into()));
                assert!(!has_text(page, &["Hello world"], false).await?);
                assert!(has_text(page, &["absent", "Hello world"], true).await?);
                assert!(!is_enabled_at(page, ".pick", Some(0), &["disabled"]).await?);
                assert!(is_enabled_at(page, ".pick", Some(1), &["disabled"]).await?);
                install_click_listener(page, "Yes", "picked").await?;
                scroll_into_view(page, ".pick", &ScrollOptions { index: Some(1), wait_after_scroll: Duration::ZERO, ..Default::default() }).await?;
                click_button(page, ".pick", &ClickOptions { index: Some(1), verify: false, wait_after_click: Duration::ZERO, wait_after_scroll: Duration::ZERO, ..Default::default() }).await?;
                assert_eq!(read_flag(page, "picked").await?, FlagRead::Observed(true));
                assert_eq!(read_flag(page, "picked").await?, FlagRead::Observed(true));
                assert!(uninstall_click_listener(page, "picked").await?);
                page.evaluate("sessionStorage.removeItem('picked'); document.querySelectorAll('.pick')[1].click()").await?;
                assert_eq!(read_flag(page, "picked").await?, FlagRead::Observed(false));
                assert!(!is_checked(page, "#check", None).await?);
                assert_eq!(check(page, "#check", true, None).await?["changed"], true);
                assert_eq!(check(page, "#check", true, None).await?["changed"], false);
                assert_eq!(check(page, "#check", false, None).await?["verified"], true);
                assert_eq!(check(page, "#radio", true, None).await?["checked"], true);
                set_cookies(page, vec![
                    json!({"name":"session","value":"artificial","domain":"example.test","path":"/","expires":0,"httpOnly":true,"sameSite":"lax"}),
                    json!({"name":"keep","value":"artificial","domain":"notexample.test","path":"/","expires":-1})
                ]).await?;
                let state = save_storage_state(page, None).await?;
                let cookie = state.cookies.iter().find(|c| c["name"] == "session").expect("session cookie");
                assert_eq!(cookie["httpOnly"], true);
                assert_eq!(cookie["sameSite"], "Lax");
                assert_eq!(cookie["expires"].as_f64(), Some(-1.0));
                assert_eq!(clear_cookies(page, Some("example.test")).await?, 1);
                let state = save_storage_state(page, None).await?;
                assert!(state.cookies.iter().any(|c| c["name"] == "keep"));
                assert!(!state.cookies.iter().any(|c| c["name"] == "session"));
                clear_cookies(page, None).await?;
                Ok(())
            }.await;
            let closed = result.close().await;
            observed?;
            closed?;
        }
        Ok::<_, anyhow::Error>(())
    }).await;
    server.abort();
    let _ = server.await;
    checks??;
    Ok(())
}

#[tokio::test]
#[ignore = "requires Chromium and JS engine packages; exercised by parity CI"]
async fn session_persistence_and_engine_profile_discovery() -> anyhow::Result<()> {
    let directory = create_temporary_user_data_dir(None)?;
    let executable = std::env::var_os("CHROME_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| "/usr/bin/google-chrome".into());
    let mut options = LaunchOptions::playwright()
        .launch(LaunchMode::Engine)
        .headless(true)
        .sandbox(false)
        .executable_path(&executable)
        .user_data_dir(&directory)
        .node_working_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js"));
    options.persist_session_cookies = Some(directory.join("session.json"));
    let work = async {
        let first = launch_browser(options.clone()).await?;
        let seeded = set_cookies(first.page.as_ref(), vec![
            json!({"name":"session","value":"artificial","domain":"example.test","path":"/","expires":0,"httpOnly":true}),
            json!({"name":"persistent","value":"artificial","domain":"example.test","path":"/","expires":9999999999i64})
        ]).await;
        let stopped = first.close().await;
        seeded?;
        stopped?;
        let second = launch_browser(options).await?;
        let state = save_storage_state(second.page.as_ref(), None).await;
        let stopped = second.close().await;
        assert!(state?
            .cookies
            .iter()
            .any(|cookie| cookie["name"] == "session"));
        stopped?;
        let sessions = find_site_sessions(
            &["example.test".into()],
            &[SessionSource {
                browser: "chromium".into(),
                path: directory.join("Default"),
                engine: EngineType::Playwright,
                launch: LaunchMode::Engine,
            }],
            RealBrowserOptions {
                executable_path: Some(executable),
                headless: true,
                args: vec!["--no-sandbox".into()],
                node_working_dir: Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js")),
                ..Default::default()
            },
            None,
        )
        .await?;
        assert_eq!(sessions.len(), 1);
        assert!(sessions[0].error.is_none(), "{:?}", sessions[0].error);
        assert!(sessions[0]
            .cookies
            .iter()
            .any(|cookie| cookie["name"] == "persistent"));
        Ok::<_, anyhow::Error>(())
    };
    let observed = tokio::time::timeout(Duration::from_secs(60), work).await;
    remove_user_data_dir(&directory).await?;
    observed??;
    Ok(())
}
