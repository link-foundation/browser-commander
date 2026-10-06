// feature-parity: safari.control@native-typed safari.setup@native-typed safari.seed@native-typed safari.unsupported@native-typed
use browser_commander::browser::find_browser_source;
use browser_commander::browser::webdriver::{
    build_capabilities, WebDriverBrowser, WebDriverOptions,
};
use browser_commander::core::engine::EngineError;
use serde_json::json;
#[path = "support/webdriver_fixture.rs"]
mod fixture;

#[test]
fn safari_catalogue_exposes_webdriver() {
    for name in ["safari", "safari-tp"] {
        let source = find_browser_source(name).unwrap();
        assert_eq!(source.control_protocol.as_deref(), Some("webdriver"));
        assert!(source.executables["darwin"][0].ends_with("/safaridriver"));
    }
}

#[test]
fn safari_capabilities_have_no_chromium_profile_or_bidi() {
    for (browser, name) in [
        (WebDriverBrowser::Safari, "safari"),
        (
            WebDriverBrowser::SafariTechnologyPreview,
            "Safari Technology Preview",
        ),
    ] {
        let caps = build_capabilities(
            &WebDriverOptions {
                browser,
                ..Default::default()
            },
            std::path::Path::new("unused"),
            None,
        )
        .unwrap();
        assert_eq!(
            caps,
            json!({"browserName":name}).as_object().unwrap().clone()
        );
    }
}

#[test]
fn unsupported_safari_options_fail_with_a_typed_error() {
    for options in [
        WebDriverOptions {
            headless: true,
            ..Default::default()
        },
        WebDriverOptions {
            user_data_dir: Some("profile".into()),
            ..Default::default()
        },
        WebDriverOptions {
            args: vec!["--flag".into()],
            ..Default::default()
        },
        WebDriverOptions {
            capabilities: json!({"webSocketUrl":true}).as_object().unwrap().clone(),
            ..Default::default()
        },
    ] {
        let error = build_capabilities(
            &WebDriverOptions {
                browser: WebDriverBrowser::Safari,
                ..options
            },
            std::path::Path::new("unused"),
            None,
        )
        .unwrap_err();
        assert!(
            matches!(error.downcast_ref::<EngineError>(), Some(EngineError::Unsupported {browser, ..}) if browser == "safari")
        );
    }
}

#[test]
fn setup_error_explains_manual_authorization() {
    use browser_commander::browser::safari::SafariSetupError;
    let error = SafariSetupError {
        cause: anyhow::anyhow!("Allow Remote Automation disabled"),
        driver: "/usr/bin/safaridriver".into(),
    };
    let message = error.to_string();
    for step in [
        "Show features for web developers",
        "Allow Remote Automation",
        "--enable",
        "admin password",
        "open_safari_settings",
    ] {
        assert!(message.contains(step));
    }
}

#[tokio::test]
async fn common_native_browser_selection_reaches_safari_validation() {
    let mut options = browser_commander::LaunchOptions::fantoccini().headless(true);
    options.webdriver.browser = WebDriverBrowser::Safari;
    let error = match browser_commander::launch_browser(options).await {
        Err(error) => error,
        Ok(_) => panic!("Safari must reject headless before starting a driver"),
    };
    assert!(
        matches!(error.downcast_ref::<EngineError>(), Some(EngineError::Unsupported {feature, ..}) if feature == "headless")
    );
}

#[tokio::test]
#[ignore = "requires macOS with safaridriver --enable and Allow Remote Automation"]
async fn safari_local_page_smoke() -> anyhow::Result<()> {
    use browser_commander::browser::storage_state::{StorageOrigin, StorageState};
    use browser_commander::core::engine::EngineAdapter;
    use browser_commander::{
        launch_browser, launch_real_browser, LaunchOptions, RealBrowserOptions,
    };
    use fantoccini::Locator;
    let (url, stop, server) = fixture::start().await?;
    let result = tokio::time::timeout(std::time::Duration::from_secs(60), async {
        let launched = launch_real_browser(RealBrowserOptions::default().channel("safari").storage_state(StorageState {
            cookies:vec![json!({"name":"seed","value":"yes","domain":"127.0.0.1","path":"/","httpOnly":true})],
            origins:vec![StorageOrigin {origin:url.clone(),local_storage:vec![]}],
        })).await?;
        let native = launched.webdriver.as_ref().unwrap();
        assert!(native.user_data_dir().as_os_str().is_empty());
        assert!(native.bidi().is_none());
        let client = native.client();
        client.goto(&url).await?;
        client.execute("document.documentElement.innerHTML='<head><title>Safari smoke</title></head><body><input id=name><button id=go>Go</button><p id=out></p></body>';document.querySelector('#go').onclick=()=>{document.querySelector('#out').textContent=document.querySelector('#name').value}",vec![]).await?;
        native.fill("#name","Safari").await?;
        client.find(Locator::Css("#go")).await?.click().await?;
        assert_eq!(native.text_content("#out").await?, Some("Safari".into()));
        assert_eq!(native.evaluate("2+3").await?,json!(5));
        assert_eq!(client.execute_async("const done=arguments[arguments.length-1];Promise.resolve(5).then(done)",vec![]).await?,json!(5));
        assert!(client.screenshot().await?.len()>100);
        assert!(client.get_all_cookies().await?.iter().any(|cookie|cookie.name()=="seed"));
        let initial=client.window().await?;
        for tab in [true,false] {
            let window=client.new_window(tab).await?;
            client.switch_to_window(window.handle).await?;
            client.goto(&url).await?;
            client.close_window().await?;
            client.switch_to_window(initial.clone()).await?;
        }
        assert!(matches!(native.pdf(Default::default()).await,Err(EngineError::Unsupported {..})));
        assert!(native.require_feature("network interception").is_err());
        assert!(native.require_feature("tracing").is_err());
        launched.close().await?;
        let common=launch_browser(LaunchOptions {channel:Some("safari".into()),..Default::default()}).await?;
        common.page.goto(&url).await?;
        assert!(!common.page.export_storage_state().await?["cookies"].as_array().unwrap().iter().any(|cookie|cookie["name"]=="seed"));
        common.close().await?;
        Ok::<(),anyhow::Error>(())
    }).await;
    let _ = stop.send(());
    server.await?;
    result?
}
