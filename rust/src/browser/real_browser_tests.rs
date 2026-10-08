//! Unit tests for [`super`], mirroring `js/tests/unit/browser/real-browser.test.js`.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};

use super::*;
use crate::browser::browser_process::fake::FakeProcess;
use crate::browser::profile_directory::{create_temporary_user_data_dir, FIRST_RUN_SENTINEL};
use crate::fingerprint::automation_parity::disables_automation_controlled;

const DEDICATED: &str = "/tmp/browser-commander-dedicated";

#[test]
fn cdp_validation_rejects_other_protocols() {
    for channel in ["firefox", "librewolf", "safari", "duckduckgo"] {
        let options = RealBrowserOptions {
            channel: channel.into(),
            ..Default::default()
        };
        let error = validate_launch_request(&options).unwrap_err();
        assert!(error.to_string().contains("does not support CDP"));
    }
}

fn dedicated(port: u16) -> RealBrowserOptions {
    RealBrowserOptions::default()
        .user_data_dir(DEDICATED)
        .remote_debugging_port(port)
}

enum Endpoint {
    Ready,
    Race,
}

/// Executable, arguments and child environment of one spawn.
type SpawnCall = (PathBuf, Vec<String>, Option<HashMap<String, String>>);

#[derive(Default)]
struct FakeHooks {
    calls: Mutex<Vec<String>>,
    ports: Mutex<VecDeque<u16>>,
    endpoints: Mutex<VecDeque<Endpoint>>,
    processes: Mutex<Vec<Arc<FakeProcess>>>,
    spawned: Mutex<Vec<SpawnCall>>,
    graceful: bool,
}

impl FakeHooks {
    fn with_ports(ports: &[u16]) -> Self {
        Self {
            ports: Mutex::new(ports.iter().copied().collect()),
            ..Self::default()
        }
    }

    fn record(&self, call: impl Into<String>) {
        self.calls.lock().unwrap().push(call.into());
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    fn process(&self, index: usize) -> Arc<FakeProcess> {
        Arc::clone(&self.processes.lock().unwrap()[index])
    }
}

#[async_trait]
impl LaunchHooks for FakeHooks {
    fn resolve_executable(&self, _options: &RealBrowserOptions) -> Result<PathBuf> {
        Ok(PathBuf::from("/opt/google/chrome"))
    }

    fn reserve_port(&self) -> Result<u16> {
        self.ports
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| anyhow!("no ports left"))
    }

    async fn spawn_browser(
        &self,
        executable_path: &Path,
        args: &[String],
        env: Option<HashMap<String, String>>,
        _verbose: bool,
    ) -> Result<SpawnedBrowser> {
        self.spawned
            .lock()
            .unwrap()
            .push((executable_path.to_path_buf(), args.to_vec(), env));
        let process = FakeProcess::new();
        self.processes.lock().unwrap().push(Arc::clone(&process));
        Ok(SpawnedBrowser {
            process: process.handle(),
            dev_tools_output: None,
        })
    }

    async fn wait_for_endpoint(&self, request: CdpEndpointRequest<'_>) -> Result<String> {
        let port = request.remote_debugging_port;
        self.record(format!("wait {port}"));
        let endpoint = self.endpoints.lock().unwrap().pop_front();
        match endpoint {
            Some(Endpoint::Race) => Err(PortRaceError::new(port, Some("taken".to_string())).into()),
            Some(Endpoint::Ready) | None => Ok(format!("http://127.0.0.1:{port}")),
        }
    }

    async fn request_close(&self, cdp_endpoint: &str, _timeout: Duration) -> Result<()> {
        self.record(format!("close {cdp_endpoint}"));
        if self.graceful {
            let process = self.processes.lock().unwrap().last().cloned();
            if let Some(process) = process {
                process.exit(0);
            }
        }
        Ok(())
    }
}

async fn launch(
    options: &RealBrowserOptions,
    hooks: &Arc<FakeHooks>,
) -> Result<(ConnectOptions, LaunchedRealBrowser)> {
    let hooks: Arc<dyn LaunchHooks> = Arc::clone(hooks) as Arc<dyn LaunchHooks>;
    launch_real_browser_with(options, hooks, |connect| async move { Ok(connect) }).await
}

#[test]
fn builds_exactly_the_command_line_a_person_would_type() {
    // Issue #103: nothing but the dedicated profile and a fixed port.
    assert_eq!(
        build_real_browser_args(&dedicated(9333)).unwrap(),
        [
            "--user-data-dir=/tmp/browser-commander-dedicated",
            "--remote-debugging-port=9333",
            "about:blank",
        ]
    );
}

#[test]
fn opens_a_blank_tab_unless_the_caller_passes_a_start_url() {
    let args = build_real_browser_args(&dedicated(9333).with_args(vec![
        "--lang=en-US".to_string(),
        "https://example.com/".to_string(),
    ]))
    .unwrap();
    assert_eq!(
        args.last().map(String::as_str),
        Some("https://example.com/")
    );
    assert!(!args.iter().any(|arg| arg == START_URL));
}

#[test]
fn building_the_command_line_needs_a_profile_and_a_port() {
    let error = build_real_browser_args(&RealBrowserOptions::default()).unwrap_err();
    assert!(error.to_string().contains("user_data_dir"));
    let error = build_real_browser_args(&RealBrowserOptions::default().user_data_dir(DEDICATED))
        .unwrap_err();
    assert!(error.to_string().contains("remote_debugging_port"));
}

#[test]
fn never_turns_automation_controlled_on_in_a_headful_launch() {
    // Issue #101.
    let args = build_real_browser_args(
        &dedicated(9333)
            .restrictions(["legacy-defaults", "no-extensions", "no-translate"])
            .with_args(vec!["--lang=en-US".to_string()]),
    )
    .unwrap();
    assert!(detect_automation_controlled_triggers(&args).is_empty());
    // ...so the switch that shows the unsupported-flag infobar is not needed.
    assert!(!disables_automation_controlled(&args));
}

#[test]
fn refuses_port_zero_which_makes_navigator_webdriver_true() {
    let error = build_real_browser_args(&dedicated(0)).unwrap_err();
    assert!(error.to_string().contains("AutomationControlled"));
}

#[test]
fn launches_headless_exactly_as_a_person_would_with_no_off_switch() {
    // A hand-started headless Chrome reports navigator.webdriver false, so the
    // off switch would only be a command-line difference of its own.
    assert_eq!(
        build_real_browser_args(&dedicated(9333).headless(true)).unwrap(),
        [
            "--user-data-dir=/tmp/browser-commander-dedicated",
            "--remote-debugging-port=9333",
            "--headless=new",
            "about:blank",
        ]
    );
}

#[test]
fn adds_the_off_switch_when_a_custom_argument_is_a_trigger() {
    let args = build_real_browser_args(&dedicated(9333).with_args(vec![
        "--disable-blink-features=Foo".to_string(),
        "--enable-automation".to_string(),
    ]))
    .unwrap();
    assert_eq!(
        args,
        [
            "--user-data-dir=/tmp/browser-commander-dedicated",
            "--remote-debugging-port=9333",
            "--disable-blink-features=Foo,AutomationControlled",
            "--enable-automation",
            "about:blank",
        ]
    );
    let without_parity = build_real_browser_args(
        &dedicated(9333)
            .with_args(vec!["--enable-automation".to_string()])
            .automation_parity(false),
    )
    .unwrap();
    assert!(!without_parity
        .iter()
        .any(|arg| arg == "--disable-blink-features=AutomationControlled"));
}

#[test]
fn applies_opt_in_restrictions_and_merges_feature_lists() {
    let args = build_real_browser_args(
        &dedicated(9333)
            .restrictions(["no-sync", "no-translate"])
            .with_args(vec![
                "--legacy-arg".to_string(),
                "--disable-features=Foo".to_string(),
            ])
            .with_extra_args(vec!["--lang=en-US".to_string()]),
    )
    .unwrap();
    assert_eq!(
        args,
        [
            "--user-data-dir=/tmp/browser-commander-dedicated",
            "--remote-debugging-port=9333",
            "--disable-sync",
            "--disable-features=Translate,Foo",
            "--legacy-arg",
            "--lang=en-US",
            "about:blank",
        ]
    );
    let error =
        build_real_browser_args(&dedicated(9333).restrictions(["no-such-thing"])).unwrap_err();
    assert!(error.to_string().contains("Unknown launch restriction"));
}

#[test]
fn rejects_arguments_that_could_bypass_protected_cdp_settings() {
    for argument in [
        "--remote-debugging-address=0.0.0.0",
        "--remote-debugging-port=9222",
        "--remote-debugging-pipe",
        "--user-data-dir=/tmp/other",
    ] {
        let error =
            build_real_browser_args(&dedicated(9333).with_args(vec![argument.into()])).unwrap_err();
        assert!(
            error.to_string().contains("managed by launch_real_browser"),
            "{argument}: {error}"
        );
    }
}

#[test]
fn default_options_use_the_native_engine_and_no_extra_switches() {
    let options = RealBrowserOptions::default();
    assert_eq!(options.engine, EngineType::Chromiumoxide);
    assert_eq!(options.channel, "chrome");
    assert_eq!(options.remote_debugging_port, None);
    assert_eq!(options.port_attempts, DEFAULT_PORT_ATTEMPTS);
    assert_eq!(options.close_timeout, DEFAULT_CLOSE_TIMEOUT);
    assert_eq!(options.slow_mo, 0);
    assert_eq!(RealBrowserOptions::playwright().slow_mo, 0);
    assert!(options.automation_parity);
    assert!(options.restrictions.is_empty());
    assert!(options.user_data_dir.is_none());
}

#[test]
fn connection_options_carry_the_download_setting() {
    // A setting that stopped here would leave an installed browser saving
    // downloads wherever Chrome felt like, which is the case issue #88 is
    // about.
    let options = RealBrowserOptions::default().downloads(true);
    let connection = connection_options(&options, "http://127.0.0.1:9222").expect("options");
    assert!(matches!(connection.downloads, DownloadSetting::On));
}

#[test]
fn rejects_fantoccini_before_connecting() {
    let options = RealBrowserOptions {
        engine: EngineType::Fantoccini,
        ..RealBrowserOptions::default()
    };
    assert!(connection_options(&options, "http://127.0.0.1:9222").is_err());
}

#[tokio::test]
async fn rejects_fantoccini_before_starting_a_browser() {
    let options = RealBrowserOptions {
        engine: EngineType::Fantoccini,
        executable_path: Some(PathBuf::from("missing-browser")),
        ..RealBrowserOptions::default()
    };
    let error = launch_real_browser(options).await.unwrap_err();
    assert!(error.to_string().contains("does not connect over CDP"));
}

#[tokio::test]
async fn refuses_port_zero_before_starting_a_browser() {
    let hooks = Arc::new(FakeHooks::default());
    let options = RealBrowserOptions::default().remote_debugging_port(0);
    let error = launch(&options, &hooks).await.unwrap_err();
    assert!(error.to_string().contains("AutomationControlled"));
    assert!(hooks.spawned.lock().unwrap().is_empty());
}

#[tokio::test]
async fn spawns_waits_connects_and_returns_process_metadata() {
    let profile = create_temporary_user_data_dir(None).unwrap();
    let hooks = Arc::new(FakeHooks::with_ports(&[9444]));
    let options = RealBrowserOptions::puppeteer()
        .user_data_dir(&profile)
        .seed_cookies(vec![serde_json::json!({"name": "SID", "value": "saved"})]);

    let (connect, launched) = launch(&options, &hooks).await.unwrap();

    assert_eq!(launched.cdp_endpoint, "http://127.0.0.1:9444");
    assert_eq!(launched.remote_debugging_port, 9444);
    assert_eq!(
        launched.executable_path,
        PathBuf::from("/opt/google/chrome")
    );
    assert_eq!(launched.user_data_dir, profile);
    assert!(!launched.temporary_profile);
    let expected_args = vec![
        format!("--user-data-dir={}", profile.display()),
        "--remote-debugging-port=9444".to_string(),
        START_URL.to_string(),
    ];
    assert_eq!(launched.args, expected_args);
    let spawned = hooks.spawned.lock().unwrap().clone();
    assert_eq!(
        spawned,
        [(PathBuf::from("/opt/google/chrome"), expected_args, None)]
    );
    assert_eq!(hooks.calls(), ["wait 9444"]);
    assert_eq!(connect.engine, EngineType::Puppeteer);
    assert_eq!(
        connect.cdp_endpoint.as_deref(),
        Some("http://127.0.0.1:9444")
    );
    assert_eq!(connect.seed_cookies.len(), 1);
    // First-run UI is suppressed with Chrome's own sentinel, not a switch.
    assert!(profile.join(FIRST_RUN_SENTINEL).exists());
    assert_eq!(launched.browser_process.pid(), Some(4242));

    launched.closer.close().await.unwrap();
    // A caller-owned profile is kept.
    assert!(profile.exists());
    remove_user_data_dir(&profile).await.unwrap();
}

#[tokio::test]
async fn migrates_bookmarks_into_the_profile_before_launch() {
    // feature-parity: migration.launch@native-typed
    let source = create_temporary_user_data_dir(None).unwrap();
    let source_profile = source.join("Default");
    std::fs::create_dir_all(&source_profile).unwrap();
    let bookmarks = serde_json::json!({
        "roots": {"bookmark_bar": {"children": [
            {"type": "url", "name": "Example", "url": "https://example.com/"}
        ]}}
    });
    std::fs::write(
        source_profile.join("Bookmarks"),
        serde_json::to_vec(&bookmarks).unwrap(),
    )
    .unwrap();
    let target = create_temporary_user_data_dir(None).unwrap();
    let hooks = Arc::new(FakeHooks::with_ports(&[9445]));
    let mut options = RealBrowserOptions::default()
        .user_data_dir(&target)
        .migrate_from(MigrationSource {
            browser: "chrome".to_string(),
            profile: None,
            user_data_dir: Some(source.clone()),
        })
        .migrate_include(["bookmarks", "paymentCards"]);
    options.migrate_include_payment_cards = true;

    let (connect, launched) = launch(&options, &hooks).await.unwrap();
    assert_eq!(connect.seed_cookies.len(), 0);
    assert_eq!(launched.migration.as_ref().unwrap().migrated.bookmarks, 1);
    assert_eq!(
        launched.migration.as_ref().unwrap().skipped[0].reason,
        "data-class-not-supported"
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(
            &std::fs::read(target.join("Default/Bookmarks")).unwrap()
        )
        .unwrap(),
        bookmarks
    );
    launched.closer.close().await.unwrap();
    remove_user_data_dir(&source).await.unwrap();
    remove_user_data_dir(&target).await.unwrap();
}

#[tokio::test]
async fn migration_error_prevents_browser_spawn() {
    let hooks = Arc::new(FakeHooks::with_ports(&[9446]));
    let options = RealBrowserOptions::default()
        .migrate_from(MigrationSource {
            browser: "unknown".to_string(),
            profile: None,
            user_data_dir: None,
        })
        .migrate_include(["bookmarks"]);

    let error = launch(&options, &hooks).await.unwrap_err();
    assert!(error.to_string().contains("unknown"));
    assert!(hooks.spawned.lock().unwrap().is_empty());
}

#[tokio::test]
async fn retries_with_a_new_reserved_port_after_a_port_race() {
    let hooks = Arc::new(FakeHooks::with_ports(&[40001, 40002]));
    hooks
        .endpoints
        .lock()
        .unwrap()
        .extend([Endpoint::Race, Endpoint::Ready]);
    let options = RealBrowserOptions::default().close_timeout(Duration::from_millis(50));

    let (_, launched) = launch(&options, &hooks).await.unwrap();

    assert_eq!(hooks.calls(), ["wait 40001", "wait 40002"]);
    assert_eq!(hooks.process(0).kill_count(), 1);
    assert_eq!(hooks.process(1).kill_count(), 0);
    assert_eq!(launched.remote_debugging_port, 40002);
    assert_eq!(launched.args[1], "--remote-debugging-port=40002");
    launched.closer.close().await.unwrap();
}

#[tokio::test]
async fn does_not_retry_a_port_the_caller_chose() {
    let hooks = Arc::new(FakeHooks::default());
    hooks
        .endpoints
        .lock()
        .unwrap()
        .extend([Endpoint::Race, Endpoint::Ready]);
    let options = RealBrowserOptions::default().remote_debugging_port(9555);

    let error = launch(&options, &hooks).await.unwrap_err();

    assert_eq!(
        error
            .downcast_ref::<crate::browser::launch_diagnostics::BrowserLaunchError>()
            .unwrap()
            .category,
        "port_race"
    );
    assert_eq!(hooks.calls(), ["wait 9555"]);
    assert_eq!(hooks.process(0).kill_count(), 1);
}

#[tokio::test]
async fn gives_up_after_the_configured_port_attempts() {
    let hooks = Arc::new(FakeHooks::with_ports(&[40011, 40012, 40013]));
    hooks
        .endpoints
        .lock()
        .unwrap()
        .extend([Endpoint::Race, Endpoint::Race, Endpoint::Race]);
    let options = RealBrowserOptions::default().port_attempts(2);

    let error = launch(&options, &hooks).await.unwrap_err();

    assert_eq!(
        error
            .downcast_ref::<crate::browser::launch_diagnostics::BrowserLaunchError>()
            .unwrap()
            .category,
        "port_race"
    );
    assert_eq!(hooks.calls(), ["wait 40011", "wait 40012"]);
}

#[tokio::test]
async fn uses_a_fresh_temporary_profile_by_default_and_deletes_it_on_close() {
    let hooks = Arc::new(FakeHooks::with_ports(&[40003]));
    let options = RealBrowserOptions::default().close_timeout(Duration::from_millis(50));

    let (_, launched) = launch(&options, &hooks).await.unwrap();

    assert!(launched.temporary_profile);
    let name = launched
        .user_data_dir
        .file_name()
        .unwrap()
        .to_string_lossy();
    assert!(name.starts_with("browser-commander-profile-"), "{name}");
    assert!(launched.user_data_dir.join(FIRST_RUN_SENTINEL).exists());

    launched.closer.close().await.unwrap();
    // The browser ignored Browser.close, so it was killed after the timeout.
    assert_eq!(
        hooks.calls(),
        ["wait 40003", "close http://127.0.0.1:40003"]
    );
    assert_eq!(hooks.process(0).kill_count(), 1);
    assert!(!launched.user_data_dir.exists());
    // Closing again does nothing.
    launched.closer.close().await.unwrap();
    assert_eq!(hooks.process(0).kill_count(), 1);
}

#[tokio::test]
async fn closes_the_browser_gracefully_before_killing_it() {
    let hooks = Arc::new(FakeHooks {
        graceful: true,
        ..FakeHooks::with_ports(&[40004])
    });
    let (_, launched) = launch(&RealBrowserOptions::default(), &hooks)
        .await
        .unwrap();

    launched.closer.close().await.unwrap();

    assert_eq!(hooks.process(0).kill_count(), 0);
    assert_eq!(launched.browser_process.exit_code(), Some(0));
    assert!(!launched.user_data_dir.exists());
}

#[tokio::test]
async fn removes_the_temporary_profile_when_the_browser_exits_on_its_own() {
    let hooks = Arc::new(FakeHooks::with_ports(&[40006]));
    let (_, launched) = launch(&RealBrowserOptions::default(), &hooks)
        .await
        .unwrap();
    assert!(launched.user_data_dir.exists());

    // The person closed the window.
    hooks.process(0).exit(0);
    for _ in 0..100 {
        if !launched.user_data_dir.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(!launched.user_data_dir.exists());
}

#[tokio::test]
async fn passes_restriction_environment_to_the_browser_only() {
    let before = std::env::var_os("GOOGLE_API_KEY");
    let hooks = Arc::new(FakeHooks::with_ports(&[40005]));
    let options = RealBrowserOptions::default()
        .restrictions(["no-google-services"])
        .env(HashMap::from([("EXTRA".to_string(), "1".to_string())]))
        .close_timeout(Duration::from_millis(50));

    let (_, launched) = launch(&options, &hooks).await.unwrap();

    let env = hooks.spawned.lock().unwrap()[0].2.clone().unwrap();
    assert_eq!(env["GOOGLE_API_KEY"], "no");
    assert_eq!(env["GOOGLE_DEFAULT_CLIENT_ID"], "no");
    assert_eq!(env["EXTRA"], "1");
    assert_eq!(std::env::var_os("GOOGLE_API_KEY"), before);
    launched.closer.close().await.unwrap();
}

#[tokio::test]
async fn terminates_the_spawned_browser_when_connection_fails() {
    let hooks = Arc::new(FakeHooks::with_ports(&[9222]));
    let dyn_hooks: Arc<dyn LaunchHooks> = Arc::clone(&hooks) as Arc<dyn LaunchHooks>;
    let options = RealBrowserOptions::default().close_timeout(Duration::from_millis(50));

    let error = launch_real_browser_with(&options, dyn_hooks, |_| async {
        Err::<(), _>(anyhow!("connection failed"))
    })
    .await
    .unwrap_err();

    assert!(error.to_string().contains("connection failed"));
    assert_eq!(hooks.process(0).kill_count(), 1);
    let args = hooks.spawned.lock().unwrap()[0].1.clone();
    let profile = PathBuf::from(args[0].trim_start_matches("--user-data-dir="));
    assert!(!profile.exists());
}
