//! Typed Puppeteer from Rust over the JavaScript CLI's `serve --stdio`
//! bridge (issue #108). Real Chrome; run with `--ignored`.

use std::time::Duration;

use browser_commander::puppeteer::{
    decode_handle, BridgeOptions, ConsoleMessage, ElementHandle, FromWire, JsFunction,
    PuppeteerBridge, Remote,
};
use serde_json::{json, Value};

fn launch_options() -> Value {
    let mut options = json!({ "headless": true });
    match std::env::var("CHROME_PATH") {
        Ok(path) if !path.is_empty() => options["executablePath"] = json!(path),
        _ => options["channel"] = json!("chrome"),
    }
    if std::env::var("CHROME_NO_SANDBOX").as_deref() == Ok("true") {
        options["args"] = json!(["--no-sandbox"]);
    }
    options
}

// feature-parity: engine.puppeteer@typed-via-bridge
#[tokio::test]
#[ignore]
async fn typed_puppeteer_over_the_bridge() {
    tokio::time::timeout(Duration::from_secs(120), async {
        let bridge = PuppeteerBridge::launch(BridgeOptions::default())
            .await
            .expect("start serve --stdio");
        let client = bridge.client().clone();
        let puppeteer = bridge.puppeteer().await.expect("puppeteer root");
        let browser = puppeteer
            .launch(Some(launch_options()))
            .await
            .unwrap_or_else(|err| panic!("{err}\n{}", bridge.stderr_tail().join("\n")));

        let page = browser.new_page(None).await.unwrap();
        page.set_content("<title>bridge</title><p id='greeting'>héllo</p>", None)
            .await
            .unwrap();
        assert_eq!(page.title().await.unwrap(), "bridge");
        let sum = page
            .evaluate(JsFunction::source("(a, b) => a + b"), &[json!(2), json!(3)])
            .await
            .unwrap();
        assert_eq!(sum, json!(5));

        let paragraph: ElementHandle = page.query_selector("#greeting").await.unwrap().unwrap();
        assert_eq!(paragraph.remote().client().close_reason(), None);
        let text = page
            .eval_on_selector(
                "#greeting",
                JsFunction::source("(node) => node.textContent"),
                &[],
            )
            .await
            .unwrap();
        assert_eq!(text, json!("héllo"));
        assert!(page.query_selector("#missing").await.unwrap().is_none());

        let png = page.screenshot(Some(json!({ "type": "png" }))).await.unwrap();
        let png = Vec::<u8>::from_wire(&client, png).unwrap();
        assert!(png.starts_with(b"\x89PNG"), "{:?}", &png[..8.min(png.len())]);

        let mut subscription = page.remote().subscribe("console").await.unwrap();
        page.evaluate(JsFunction::source("() => console.log('from the page')"), &[])
            .await
            .unwrap();
        let args = tokio::time::timeout(Duration::from_secs(10), subscription.next())
            .await
            .expect("a console event")
            .expect("an open subscription");
        let message: ConsoleMessage = decode_handle(&client, args[0].clone()).unwrap();
        assert_eq!(message.text().await.unwrap(), "from the page");
        subscription.close().await.unwrap();

        let error = page
            .wait_for_selector("#never", Some(json!({ "timeout": 50 })))
            .await
            .unwrap_err();
        assert!(error.is_timeout(), "{error}");

        assert!(browser.pages(None).await.unwrap().contains(&page));
        browser.close().await.unwrap();
        let pid = bridge.pid().expect("server pid");
        bridge.close().await;
        #[cfg(target_os = "linux")]
        assert!(
            !std::path::Path::new(&format!("/proc/{pid}")).exists()
                || std::fs::read_to_string(format!("/proc/{pid}/stat"))
                    .map(|stat| stat.contains(") Z "))
                    .unwrap_or(true),
            "serve --stdio {pid} outlived close()"
        );
        let _ = pid;
    })
    .await
    .expect("the bridge test finished within its budget");
}
