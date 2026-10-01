//! Native parity uses the same probe, comparison rules and report schema as JS/Python.

use browser_commander::parity::{
    classify_differences, compare_command_lines, diff_reports, parse_switches, ParityContext,
    PROBE_SOURCE,
};
use serde_json::{json, Value};

// feature-parity: parity.measure@native-typed
#[test]
fn compares_switches_features_and_attachment_without_profile_noise() {
    let reference = "/opt/Google Chrome/chrome --user-data-dir=/tmp/reference profile --headless=new --disable-features=B,A --flag-switches-begin --flag-switches-end about:blank";
    let candidate = "/opt/Google Chrome/chrome --user-data-dir=/tmp/candidate profile --headless=new --disable-features=A,C --remote-debugging-port=9222 --custom=asked";
    assert_eq!(
        parse_switches(reference)["--user-data-dir"],
        Some("/tmp/reference profile".into())
    );
    let comparison = compare_command_lines(reference, candidate);
    assert_eq!(comparison.extra, vec!["--custom=asked"]);
    assert!(comparison.missing.is_empty());
    assert_eq!(comparison.attachment, vec!["--remote-debugging-port=9222"]);
    assert_eq!(comparison.changed.len(), 1);
    assert_eq!(
        comparison.features["--disable-features"].reference,
        vec!["A", "B"]
    );
    assert_eq!(
        comparison.features["--disable-features"].candidate,
        vec!["A", "C"]
    );
    let value = serde_json::to_value(comparison).unwrap();
    assert_eq!(value["changed"][0]["name"], "--disable-features");
}

#[test]
fn probe_diff_ignores_volatile_fields_but_detects_missing_and_null() {
    let left = json!({"navigator":{"webdriver":false,"languages":["en"]}, "window":{"innerWidth":800}, "connection":{"rtt":10},"absent":null});
    let right = json!({"navigator":{"webdriver":true,"languages":["fr"]}, "window":{"innerWidth":900}, "connection":{"rtt":20}});
    let differences = diff_reports(&left, &right);
    assert_eq!(differences.len(), 3);
    assert_eq!(differences[0].path, "absent");
    assert_eq!(differences[1].path, "navigator.languages");
    assert_eq!(differences[2].path, "navigator.webdriver");
}

#[test]
fn explanations_preserve_unknown_differences_and_use_the_shared_catalogue() {
    let differences = diff_reports(
        &json!({"navigator":{"webdriver":false,"vendor":"Google Inc.","userAgentData":{"brands":[1]}}}),
        &json!({"navigator":{"webdriver":true,"vendor":"Other","userAgentData":{"brands":[2]}}}),
    );
    let (tagged, unlisted) = classify_differences(
        &differences,
        &ParityContext {
            attached: true,
            ..Default::default()
        },
    );
    assert_eq!(unlisted.len(), 1);
    assert_eq!(unlisted[0].path, "navigator.vendor");
    assert_eq!(
        tagged[0].limitation.as_deref(),
        Some("grease-brand-not-reproduced")
    );
    assert_eq!(
        tagged[2].limitation.as_deref(),
        Some("automation-controlled-is-launch-only")
    );
}

#[test]
fn ships_the_canonical_probe_bytes() {
    let source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../js/src/parity/probe.js"
    ))
    .unwrap();
    assert_eq!(PROBE_SOURCE, source);
}

#[test]
fn reference_args_preserve_exact_boundaries_and_add_no_debugger_switch() {
    use browser_commander::parity::build_reference_args;
    let args = build_reference_args(
        std::path::Path::new("/tmp/a profile"),
        "http://127.0.0.1:1234/probe/token",
        true,
        &[],
    );
    assert_eq!(
        args,
        [
            "--user-data-dir=/tmp/a profile",
            "--headless=new",
            "http://127.0.0.1:1234/probe/token"
        ]
    );
}

/// Real Chrome; no engine or debugger is attached to the environment reference.
#[tokio::test]
#[ignore]
async fn native_measurement_runs_all_cdp_engines_and_preserves_borrowed_sessions(
) -> anyhow::Result<()> {
    use browser_commander::parity::{measure_parity, measure_session_parity, MeasureParityOptions};
    use browser_commander::{launch_browser, EngineType, LaunchOptions};
    use std::time::Duration;
    let result = tokio::time::timeout(Duration::from_secs(150), async {
        for engine in [
            EngineType::Chromiumoxide,
            EngineType::Playwright,
            EngineType::Puppeteer,
        ] {
            let launch = LaunchOptions::default()
                .engine(engine)
                .headless(true)
                .sandbox(false)
                .channel("chrome")
                .node_working_dir(
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../js"),
                );
            let options = MeasureParityOptions {
                launch: launch.clone(),
                reference_args: vec!["--no-sandbox".into()],
                ..Default::default()
            };
            let report = measure_parity(options.clone()).await?;
            let json = serde_json::to_value(&report)?;
            assert_eq!(json["browser"]["engine"], engine.to_string());
            assert_eq!(json["browser"]["launch"], "real");
            assert!(json["commandLine"]["launched"]
                .as_str()
                .unwrap()
                .contains("--user-data-dir"));
            assert!(json["commandLine"]["reference"]
                .as_str()
                .unwrap()
                .contains("--user-data-dir"));
            assert_eq!(json["ok"], json["unlisted"].as_array().unwrap().is_empty());
            assert!(!report
                .differences
                .iter()
                .any(|d| d.path == "navigator.webdriver"));
            eprintln!(
                "{engine}: {} differences, {} unlisted",
                report.differences.len(),
                report.unlisted.len()
            );
            if !report.differences.is_empty() {
                eprintln!(
                    "{engine} differences: {}",
                    serde_json::to_string(&report.differences)?
                );
            }
            assert!(
                !report
                    .differences
                    .iter()
                    .any(|difference| difference.path == "screen.orientationType"),
                "{engine} changed the reference screen orientation"
            );
            if engine == EngineType::Chromiumoxide {
                let mut negative_launch = launch;
                negative_launch.args.push("--enable-automation".into());
                negative_launch.automation_parity = false;
                let session = launch_browser(negative_launch).await?;
                let measured = measure_session_parity(&session, options).await;
                let alive = session.page.evaluate("document.title = 'still open'").await;
                let path = session.browser.user_data_dir.clone();
                session.close().await?;
                assert!(measured?
                    .unlisted
                    .iter()
                    .any(|difference| difference.path == "navigator.webdriver"));
                assert_eq!(alive?, Value::String("still open".into()));
                assert!(!path.exists());
            }
        }
        Ok::<(), anyhow::Error>(())
    })
    .await?;
    result
}
