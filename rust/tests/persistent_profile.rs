//! A persistent profile keeps session cookies across a normal restart (issue
//! #187): log in on one launch, `close()`, launch the same `user_data_dir`
//! again and the cookie without an expiry date is still sent.
//! `keep_session_cookies(false)` loses it, and a temporary profile launches as
//! before. Mirrors `js/tests/e2e/issue-187-session-cookies.e2e.test.js`.
//!
//! Run with `cargo test --test persistent_profile -- --ignored --nocapture`.
//! Requires Chrome (`CHROME_PATH`), the Playwright/Puppeteer packages in
//! ../js, a chromedriver matching Chrome (`WEBDRIVER_PATH`,
//! `WEBDRIVER_BROWSER_PATH`; experiments/issue-110/resolve-webdriver.mjs
//! prints them) and Firefox (`FIREFOX_PATH` or `firefox` on PATH) with
//! geckodriver (`GECKODRIVER_PATH` or `geckodriver` on PATH).
// feature-parity: profile.session-cookies@native-typed

use std::path::PathBuf;
use std::time::Duration;

use browser_commander::browser::profile_directory::{
    create_temporary_user_data_dir, remove_user_data_dir,
};
use browser_commander::browser::{connect_or_launch, PersistentOptions};
use browser_commander::{
    launch_browser, EngineType, LaunchMode, LaunchOptions, LaunchResult, WebDriverBrowser,
};
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

const SESSION_COOKIE: &str = "sid=logged-in";

fn node_working_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js")
}

fn chrome() -> PathBuf {
    std::env::var_os("CHROME_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| "/usr/bin/google-chrome".into())
}

fn required(name: &str) -> PathBuf {
    std::env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            panic!("set {name}: node experiments/issue-110/resolve-webdriver.mjs prints it")
        })
}

/// `name` from the environment, otherwise the executable on PATH.
fn executable(variable: &str, name: &str) -> PathBuf {
    if let Some(path) = std::env::var_os(variable) {
        return path.into();
    }
    std::env::var_os("PATH")
        .and_then(|path| {
            std::env::split_paths(&path)
                .map(|directory| directory.join(name))
                .find(|candidate| candidate.is_file())
        })
        .unwrap_or_else(|| panic!("{name} is not installed: set {variable}"))
}

/// `/login` sets a session cookie: no `Expires` and no `Max-Age`.
async fn serve() -> anyhow::Result<(String, tokio::task::JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let server = tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut request = vec![0; 4096];
                let read = socket.read(&mut request).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&request[..read]);
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                let body = format!("<!doctype html><title>{path}</title>");
                let cookie = if path == "/login" {
                    format!("Set-Cookie: {SESSION_COOKIE}; Path=/\r\n")
                } else {
                    String::new()
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\n{cookie}Content-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = socket.write_all(response.as_bytes()).await;
            });
        }
    });
    Ok((origin, server))
}

/// The URLs of the page tabs a CDP browser has open, from its `/json/list`.
/// A restored tab is one at the test server's origin; the chromiumoxide
/// connector may add an `about:blank` of its own. The DevTools
/// server keeps the connection open, so the body is parsed as soon as it is
/// complete rather than at end of stream.
async fn cdp_tabs(port: u16) -> anyhow::Result<Vec<String>> {
    let read = async {
        let mut socket = TcpStream::connect(("127.0.0.1", port)).await?;
        socket
            .write_all(b"GET /json/list HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
            .await?;
        let mut response = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let read = socket.read(&mut chunk).await?;
            response.extend_from_slice(&chunk[..read]);
            let text = String::from_utf8_lossy(&response);
            let body = text.split_once("\r\n\r\n").map_or("", |(_, body)| body);
            if let Ok(targets) = serde_json::from_str::<Vec<serde_json::Value>>(body) {
                trace(&format!("targets: {targets:?}"));
                return anyhow::Ok(
                    targets
                        .iter()
                        .filter(|target| target["type"] == "page")
                        .map(|target| target["url"].as_str().unwrap_or_default().to_string())
                        .collect(),
                );
            }
            if read == 0 {
                anyhow::bail!("/json/list ended without a target list: {text}");
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(10), read).await?
}

async fn cookie(result: &LaunchResult, url: &str) -> anyhow::Result<String> {
    result.page.goto(url).await?;
    Ok(result
        .page
        .evaluate("document.cookie")
        .await?
        .as_str()
        .unwrap_or_default()
        .to_string())
}

/// Step tracing, on with `PERSISTENT_PROFILE_TRACE=1`.
fn trace(step: &str) {
    if std::env::var_os("PERSISTENT_PROFILE_TRACE").is_some() {
        eprintln!(
            "[persistent_profile {:?}] {step}",
            std::time::SystemTime::now()
        );
    }
}

/// What the second launch of a restart reports.
struct Restarted {
    cookie: String,
    keep_session_cookies: bool,
    warnings: usize,
    temporary_profile: bool,
    args: Vec<String>,
    /// Tabs right after launch that show the test server, where the browser
    /// speaks CDP: the last session's tabs, restored.
    restored_tabs: Option<usize>,
}

/// Log in on one launch, open a second tab, `close()`, launch again.
async fn restart(origin: &str, options: &LaunchOptions) -> anyhow::Result<Restarted> {
    let run = async {
        trace("first launch");
        let first = launch_browser(options.clone()).await?;
        trace("log in");
        let logged_in = cookie(&first, &format!("{origin}/login")).await;
        // A second tab, which the next launch must not reopen by default.
        let opened = first
            .page
            .evaluate("window.open('/other', '_blank'); true")
            .await;
        trace("close the first launch");
        first.close().await?;
        assert_eq!(logged_in?, SESSION_COOKIE);
        opened?;

        if let Some(profile) = &options.user_data_dir {
            let preferences = std::fs::read_to_string(profile.join("Default/Preferences"))
                .ok()
                .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok());
            trace(&format!(
                "after close: exit_type {:?}, Cookies {:?}",
                preferences.map(|value| value["profile"]["exit_type"].clone()),
                std::fs::metadata(profile.join("Default/Cookies"))
                    .map(|meta| meta.len())
                    .ok(),
            ));
        }
        trace("second launch");
        let second = launch_browser(options.clone()).await?;
        trace(&format!("second launch args: {:?}", second.args));
        let restored_tabs = match second.remote_debugging_port {
            Some(port) => Some(
                cdp_tabs(port)
                    .await?
                    .iter()
                    .filter(|url| url.starts_with(origin))
                    .count(),
            ),
            None => None,
        };
        trace("check the cookie");
        let seen = cookie(&second, &format!("{origin}/check")).await;
        let restarted = Restarted {
            cookie: String::new(),
            keep_session_cookies: second.keep_session_cookies,
            warnings: second.warnings.len(),
            temporary_profile: second.temporary_profile,
            args: second.args.clone(),
            restored_tabs,
        };
        trace("close the second launch");
        second.close().await?;
        anyhow::Ok(Restarted {
            cookie: seen?,
            ..restarted
        })
    };
    tokio::time::timeout(Duration::from_secs(180), run).await?
}

/// Every engine and launch mode a Rust caller can start a profile with.
fn launches() -> Vec<(String, LaunchOptions)> {
    let mut launches = Vec::new();
    for mode in [LaunchMode::Real, LaunchMode::Engine] {
        for options in [
            LaunchOptions::chromiumoxide(),
            LaunchOptions::playwright(),
            LaunchOptions::puppeteer(),
        ] {
            let engine = options.engine;
            launches.push((
                format!("{engine} {mode}"),
                options
                    .launch(mode)
                    .executable_path(chrome())
                    .node_working_dir(node_working_dir()),
            ));
        }
    }
    let mut chrome_driver = LaunchOptions::fantoccini()
        .launch(LaunchMode::Engine)
        .executable_path(required("WEBDRIVER_BROWSER_PATH"));
    chrome_driver.webdriver.driver_executable = Some(required("WEBDRIVER_PATH"));
    launches.push(("fantoccini chrome engine".into(), chrome_driver));
    let mut firefox = LaunchOptions::fantoccini()
        .launch(LaunchMode::Engine)
        .executable_path(executable("FIREFOX_PATH", "firefox"));
    firefox.webdriver.browser = WebDriverBrowser::Firefox;
    firefox.webdriver.driver_executable = Some(executable("GECKODRIVER_PATH", "geckodriver"));
    launches.push(("fantoccini firefox engine".into(), firefox));
    // `PERSISTENT_PROFILE_ONLY=<name>` runs the launches whose name contains it.
    let only = std::env::var("PERSISTENT_PROFILE_ONLY").unwrap_or_default();
    launches
        .into_iter()
        .filter(|(name, _)| name.contains(&only))
        .map(|(name, options)| (name, options.headless(true).sandbox(false)))
        .collect()
}

fn has_session_switch(args: &[String]) -> bool {
    args.iter().any(|argument| {
        argument == "--restore-last-session" || argument.contains("SessionRestoreInfobar")
    })
}

#[tokio::test]
#[ignore = "requires Chrome, Firefox, their drivers and ../js; exercised by parity CI"]
async fn the_session_cookie_survives_close_and_relaunch() -> anyhow::Result<()> {
    let (origin, server) = serve().await?;
    for (name, options) in launches() {
        let profile = create_temporary_user_data_dir(None)?;
        let restarted = restart(&origin, &options.user_data_dir(&profile)).await;
        remove_user_data_dir(&profile).await?;
        let restarted = restarted.map_err(|error| error.context(name.clone()))?;
        assert_eq!(restarted.cookie, SESSION_COOKIE, "{name}");
        assert!(restarted.keep_session_cookies, "{name}");
        assert_eq!(restarted.warnings, 0, "{name}");
        if let Some(restored) = restarted.restored_tabs {
            assert_eq!(
                restored, 0,
                "{name}: the last session's tabs are not restored"
            );
        }
        println!("{name}: kept {}", restarted.cookie);
    }
    server.abort();
    Ok(())
}

#[tokio::test]
#[ignore = "requires Chrome, Firefox, their drivers and ../js; exercised by parity CI"]
async fn keep_session_cookies_false_loses_it() -> anyhow::Result<()> {
    let (origin, server) = serve().await?;
    for (name, options) in launches() {
        let profile = create_temporary_user_data_dir(None)?;
        let options = options.user_data_dir(&profile).keep_session_cookies(false);
        let restarted = restart(&origin, &options).await;
        remove_user_data_dir(&profile).await?;
        let restarted = restarted.map_err(|error| error.context(name.clone()))?;
        assert_eq!(restarted.cookie, "", "{name}");
        assert!(!restarted.keep_session_cookies, "{name}");
        println!("{name}: lost with the opt-out");
    }
    server.abort();
    Ok(())
}

#[tokio::test]
#[ignore = "requires Chrome, Firefox, their drivers and ../js; exercised by parity CI"]
async fn a_temporary_profile_launches_as_before() -> anyhow::Result<()> {
    let (origin, server) = serve().await?;
    for (name, options) in launches() {
        let restarted = restart(&origin, &options)
            .await
            .map_err(|error| error.context(name.clone()))?;
        // Each launch has its own empty profile, deleted on close.
        assert_eq!(restarted.cookie, "", "{name}");
        assert!(restarted.temporary_profile, "{name}");
        assert!(!restarted.keep_session_cookies, "{name}");
        assert!(
            !has_session_switch(&restarted.args),
            "{name}: {:?}",
            restarted.args
        );
        println!("{name}: temporary profile unchanged");
    }
    server.abort();
    Ok(())
}

#[tokio::test]
#[ignore = "requires Chrome, Firefox, their drivers and ../js; exercised by parity CI"]
async fn restore_tabs_reopens_the_last_session_tabs_with_the_cookie() -> anyhow::Result<()> {
    let (origin, server) = serve().await?;
    let profile = create_temporary_user_data_dir(None)?;
    let options = LaunchOptions::chromiumoxide()
        .launch(LaunchMode::Real)
        .executable_path(chrome())
        .headless(true)
        .sandbox(false)
        .user_data_dir(&profile)
        .restore_tabs(true);
    let restarted = restart(&origin, &options).await;
    remove_user_data_dir(&profile).await?;
    let restarted = restarted?;
    assert_eq!(restarted.cookie, SESSION_COOKIE);
    // The tab opened with window.open is restored too, but before it loads
    // its URL is still about:blank, so only the login tab is counted.
    assert!(
        restarted.restored_tabs.unwrap() >= 1,
        "the last session's tabs are restored: {:?}",
        restarted.restored_tabs
    );
    server.abort();
    Ok(())
}

#[tokio::test]
#[ignore = "requires Chrome and ../js; exercised by parity CI"]
async fn connect_or_launch_keeps_the_session_cookie() -> anyhow::Result<()> {
    let (origin, server) = serve().await?;
    let profile = create_temporary_user_data_dir(None)?;
    let port = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        listener.local_addr()?.port()
    };
    let options = || {
        let mut options = PersistentOptions::new(&profile, port);
        options.connection.engine = EngineType::Playwright;
        options.connection.node_working_dir = Some(node_working_dir());
        options.launch = json!({
            "executablePath": chrome(),
            "headless": true,
            "args": ["--no-sandbox"],
        });
        options
    };
    let run = async {
        let mut first = connect_or_launch(options()).await?;
        first.page().goto(&format!("{origin}/login")).await?;
        let logged_in = first.page().evaluate("document.cookie").await?;
        first.close().await?;
        assert_eq!(logged_in.as_str(), Some(SESSION_COOKIE));

        let mut second = connect_or_launch(options()).await?;
        assert!(!second.reused, "the first browser was closed");
        let tabs = cdp_tabs(port).await;
        second.page().goto(&format!("{origin}/check")).await?;
        let seen = second.page().evaluate("document.cookie").await;
        let kept = second.keep_session_cookies();
        let warnings = second.warnings();
        second.close().await?;
        assert_eq!(seen?.as_str(), Some(SESSION_COOKIE));
        assert!(kept);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(tabs?.len(), 1, "the last session's tab is not restored");
        anyhow::Ok(())
    };
    let outcome = tokio::time::timeout(Duration::from_secs(180), run).await;
    remove_user_data_dir(&profile).await?;
    server.abort();
    outcome?
}
