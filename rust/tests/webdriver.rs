//! Managed native WebDriver launch: driver ownership, typed API and downloads.

use browser_commander::browser::webdriver::{
    build_capabilities, launch_webdriver, WebDriverBrowser, WebDriverOptions,
};
use browser_commander::downloads::{CaptureOptions, DownloadOptions};
use fantoccini::Locator;
use serde_json::json;
use std::time::Duration;
#[path = "support/webdriver_fixture.rs"]
mod fixture;

#[test]
fn capabilities_preserve_preferences_and_enable_bidi() {
    let options = WebDriverOptions {
        headless: true,
        sandbox: false,
        preferences: json!({"intl.accept_languages":"de-DE"}),
        ..Default::default()
    };
    let profile = std::env::temp_dir().join("bc-webdriver-profile");
    let staging = std::env::temp_dir().join("bc-webdriver-downloads");
    let caps = build_capabilities(&options, &profile, Some(&staging)).unwrap();
    assert_eq!(caps["webSocketUrl"], true);
    assert_eq!(
        caps["goog:chromeOptions"]["prefs"]["intl.accept_languages"],
        "de-DE"
    );
    assert_eq!(
        caps["goog:chromeOptions"]["prefs"]["download.default_directory"],
        staging.to_string_lossy().as_ref()
    );
    assert!(caps["goog:chromeOptions"]["args"]
        .as_array()
        .unwrap()
        .contains(&json!("--no-sandbox")));
    let firefox = WebDriverOptions {
        browser: WebDriverBrowser::Firefox,
        ..options
    };
    let caps = build_capabilities(&firefox, &profile, Some(&staging)).unwrap();
    assert_eq!(caps["browserName"], "firefox");
    assert_eq!(
        caps["moz:firefoxOptions"]["prefs"]["browser.download.dir"],
        staging.to_string_lossy().as_ref()
    );
    assert!(caps["moz:firefoxOptions"]["args"]
        .as_array()
        .unwrap()
        .contains(&json!("-profile")));
}

#[test]
fn invalid_preferences_are_refused_before_starting_a_driver() {
    let options = WebDriverOptions {
        preferences: json!(false),
        ..Default::default()
    };
    assert!(build_capabilities(&options, &std::env::temp_dir(), None).is_err());
}

#[test]
fn firefox_partial_downloads_are_not_reported_as_complete() {
    let root = browser_commander::browser::create_temporary_user_data_dir(None).unwrap();
    let mut watcher = browser_commander::downloads::DirectoryWatcher::new(&root);
    std::fs::write(root.join("report.pdf.part"), b"incomplete").unwrap();
    assert!(watcher.poll_once().is_empty());
    assert!(watcher.poll_once().is_empty());
    std::fs::rename(root.join("report.pdf.part"), root.join("report.pdf")).unwrap();
    assert!(watcher.poll_once().is_empty());
    assert_eq!(watcher.poll_once()[0].name, "report.pdf");
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires installed matching browser and WebDriver; set WEBDRIVER_PATH and WEBDRIVER_BROWSER_PATH"]
async fn managed_webdriver_launch_bidi_download_and_cleanup() -> anyhow::Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .try_init();
    tokio::time::timeout(Duration::from_secs(60), async {
        let driver = std::env::var("WEBDRIVER_PATH")?;
        let binary = std::env::var("WEBDRIVER_BROWSER_PATH")?;
        let output = browser_commander::browser::create_temporary_user_data_dir(None)?;
        let options = WebDriverOptions {
            browser: if std::env::var("WEBDRIVER_BROWSER").as_deref()==Ok("firefox") { WebDriverBrowser::Firefox } else { WebDriverBrowser::Chrome },
            driver_executable: Some(driver.into()),
            browser_executable: Some(binary.into()),
            headless: true,
            sandbox: false,
            downloads: DownloadOptions::default().directory(output.to_string_lossy()).into(),
            ..Default::default()
        };
        tracing::debug!("launch WebDriver");
        let browser = launch_webdriver(options).await?;
        tracing::debug!("driver launched; read BiDi tree");
        let profile = browser.user_data_dir().to_owned();
        let pid = browser.driver_pid().unwrap();
        assert!(pid > 0);
        let bidi = browser.bidi().expect("driver advertises BiDi");
        let tree = bidi.get_tree().await?;
        assert!(!tree.contexts.is_empty());
        let mut events = bidi.events();
        bidi.subscribe(&["browsingContext.load"], None).await?;
        tracing::debug!("navigate fixture");
        browser.client().goto("data:text/html,<title>native</title><input id='name'><a id='download' download='report.txt' href='data:text/plain,managed%20download'>Download</a>").await?;
        browser.client().find(Locator::Css("#name")).await?.send_keys("typed").await?;
        assert_eq!(browser.client().execute("return document.querySelector('#name').value", vec![]).await?, "typed");
        assert_eq!(tokio::time::timeout(Duration::from_secs(5), events.recv()).await??.method,"browsingContext.load");
        bidi.unsubscribe(&["browsingContext.load"],None).await?;
        use browser_commander::EngineAdapter;
        browser.fill("#name", "common").await?;
        assert_eq!(browser.input_value("#name").await?,Some("common".into()));
        assert!(!browser.screenshot().await?.is_empty());
        let (origin, stop_server, server) = fixture::start().await?;
        use browser_commander::{StorageEntry, StorageOrigin, StorageState};
        tracing::debug!("restore portable state");
        browser.restore_state(StorageState { cookies: vec![json!({"name":"native-session","value":"secret","domain":"127.0.0.1","path":"/","expires":-1,"secure":false,"httpOnly":true,"sameSite":"Lax"})], origins:vec![StorageOrigin{origin:origin.clone(),local_storage:vec![StorageEntry{name:"native-storage".into(),value:"retained".into()}]}]}).await?;
        browser.client().goto(&origin).await?;
        let state = browser.save_state().await?;
        tracing::debug!("state exported; capture download");
        assert!(state.cookies.iter().any(|cookie|cookie["name"]=="native-session"&&cookie["httpOnly"]==true));
        assert_eq!(state.origins[0].local_storage[0].value,"retained");
        let _ = stop_server.send(());
        server.await?;
        browser.client().goto("data:text/html,<a id='download' download='report.txt' href='data:text/plain,managed%20download'>Download</a>").await?;
        let manager = browser.downloads().unwrap();
        let artifact = manager.capture(CaptureOptions::named("report.txt"), async {
            browser.client().find(Locator::Css("#download")).await?.click().await?;
            Ok(())
        }).await?;
        assert_eq!(std::fs::read(artifact.path.as_ref().unwrap())?, b"managed download");
        if std::env::var("WEBDRIVER_BROWSER").as_deref()!=Ok("firefox") {
            use browser_commander::{launch_browser, launch_webdriver_snapshot, LaunchOptions, SnapshotOptions};
            let copied = launch_webdriver_snapshot(SnapshotOptions {user_data_dir:Some(profile.clone()),..Default::default()}, WebDriverOptions {
                driver_executable:Some(std::env::var("WEBDRIVER_PATH")?.into()),browser_executable:Some(std::env::var("WEBDRIVER_BROWSER_PATH")?.into()),headless:true,sandbox:false,..Default::default()
            }).await?;
            let copied_profile = copied.user_data_dir().to_owned();
            copied.close().await?;
            assert!(!copied_profile.exists());
            assert!(profile.exists());
            // feature-parity: engines.webdriver@native-typed
            let mut options = LaunchOptions::default().engine("selenium".parse()?).headless(true).sandbox(false).executable_path(std::env::var("WEBDRIVER_BROWSER_PATH")?);
            options.webdriver.driver_executable=Some(std::env::var("WEBDRIVER_PATH")?.into());
            let common = launch_browser(options).await?;
            common.page.goto("data:text/html,<input id='common'>").await?;
            common.page.fill("#common","shared launcher").await?;
            assert_eq!(common.page.input_value("#common").await?,Some("shared launcher".into()));
            let version = common.page.read_browser_version_page().await?;
            assert!(version["commandLine"].as_str().unwrap().contains("--user-data-dir"));
            let common_profile = common.browser.user_data_dir.clone();
            common.close().await?;
            assert!(!common_profile.exists());
        }
        browser.close().await?;
        tracing::debug!("driver closed");
        assert!(!profile.exists());
        #[cfg(target_os="linux")]
        assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
        std::fs::remove_dir_all(output)?;
        Ok::<_,anyhow::Error>(())
    }).await?
}
