//! Talks to a real `playwright run-driver` through the generated bindings.
//! Skipped unless PW_SMOKE_EXECUTABLE names a Chromium binary.

use playwright_harness::playwright::protocol::*;
use playwright_harness::playwright::{ChannelType, DriverOptions, PlaywrightDriver};

#[tokio::test]
async fn generated_bindings_drive_a_real_browser() {
    let Ok(executable) = std::env::var("PW_SMOKE_EXECUTABLE") else {
        eprintln!("PW_SMOKE_EXECUTABLE is not set; skipping");
        return;
    };
    let started = std::time::Instant::now();
    let driver = PlaywrightDriver::launch(DriverOptions {
        working_dir: Some(concat!(env!("CARGO_MANIFEST_DIR"), "/../../js").into()),
        verbose: true,
        ..DriverOptions::default()
    })
    .await
    .expect("driver starts");
    let connection = driver.connection().clone();
    connection.set_default_timeout(Some(30_000.0));

    let playwright = driver.playwright();
    let initializer = playwright.initializer().unwrap();
    let chromium = connection.object(&initializer.chromium).unwrap();
    let launched = chromium
        .launch(BrowserTypeLaunchParams {
            launch_options: LaunchOptions {
                executable_path: Some(executable),
                headless: Some(true),
                args: Some(vec!["--no-sandbox".into()]),
                ..LaunchOptions::default()
            },
            ..Default::default()
        })
        .await
        .expect("chromium launches");
    let browser = connection.object(&launched.browser).unwrap();
    let context = browser
        .new_context(BrowserNewContextParams::default())
        .await
        .expect("context");
    let context = connection.object(&context.context).unwrap();
    let page = context.new_page().await.expect("page");
    let page = connection.object(&page.page).unwrap();
    let frame = connection
        .object(&page.initializer().unwrap().main_frame)
        .unwrap();

    frame
        .goto(FrameGotoParams {
            url: "data:text/html,<title>t</title><h1 id=x>Hello</h1>".into(),
            wait_until: Some(LifecycleEvent::Load),
            ..Default::default()
        })
        .await
        .expect("goto");
    let value = frame
        .evaluate_expression(FrameEvaluateExpressionParams {
            expression: "() => document.querySelector('#x').textContent".into(),
            is_function: Some(true),
            arg: SerializedArgument {
                value: SerializedValue {
                    v: Some(SerializedValueV::Undefined),
                    ..Default::default()
                },
                handles: vec![],
            },
        })
        .await
        .expect("evaluate");
    assert_eq!(value.value.s.as_deref(), Some("Hello"));

    let title = frame.title().await.expect("title");
    assert_eq!(title.value, "t");

    let shot = page
        .screenshot(PageScreenshotParams::default())
        .await
        .expect("screenshot");
    assert!(shot.binary.len() > 100);

    let timed_out = connection
        .call_with_timeout(
            frame.guid(),
            "click",
            serde_json::json!({ "selector": "#missing" }),
            Some(200.0),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(&timed_out, playwright_harness::playwright::ProtocolError::Remote { name, .. } if name == "TimeoutError"),
        "{timed_out:?}"
    );

    browser
        .close(BrowserCloseParams::default())
        .await
        .expect("close");
    driver.close().await;
    eprintln!("finished in {:?}", started.elapsed());
}
