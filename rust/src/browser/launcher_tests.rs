use super::*;
use crate::fingerprint::{
    create_default_fingerprint_preset, AUTOMATION_CONTROLLED_OFF_ARG,
    PLAYWRIGHT_HEADLESS_POINTER_ARG, PLAYWRIGHT_SOFTWARE_WEBGL_ARG,
};

#[test]
fn launch_options_default() {
    let options = LaunchOptions::default();
    assert_eq!(options.engine, EngineType::Chromiumoxide);
    assert_eq!(options.launch, LaunchMode::Real);
    assert!(!options.headless);
    assert_eq!(options.slow_mo, 0);
    assert!(!options.verbose);
    assert!(options.args.is_empty());
    assert!(options.extra_args.is_empty());
    assert!(options.ignore_default_args.is_empty());
    assert!(!options.ignore_all_default_args);
    assert!(options.automation_parity);
    assert!(options.channel.is_none());
    assert!(options.executable_path.is_none());
    assert!(options.node_executable.is_none());
    assert!(options.node_working_dir.is_none());
    assert!(options.restrictions.is_empty());
    assert!(options.env.is_none());
    assert!(options.remote_debugging_port.is_none());
    // A launch without a profile has to leave the machine as it is, so the
    // browser reports the real hardware rather than a half-set one.
    assert!(options.fingerprint.is_none());
}

#[test]
fn launch_options_builder() {
    let options = LaunchOptions::chromiumoxide()
        .headless(true)
        .slow_mo(100)
        .verbose(true)
        .with_args(vec!["--custom-arg".to_string()])
        .launch(LaunchMode::Engine)
        .restrictions(["no-sync"])
        .env(HashMap::from([("TZ".to_string(), "UTC".to_string())]))
        .remote_debugging_port(9333);

    assert_eq!(options.engine, EngineType::Chromiumoxide);
    assert!(options.headless);
    assert_eq!(options.slow_mo, 100);
    assert!(options.verbose);
    assert_eq!(options.args, vec!["--custom-arg"]);
    assert_eq!(options.launch, LaunchMode::Engine);
    assert_eq!(options.restrictions, vec!["no-sync"]);
    assert_eq!(
        options.env.as_ref().and_then(|env| env.get("TZ")),
        Some(&"UTC".to_string())
    );
    assert_eq!(options.remote_debugging_port, Some(9333));
}

#[test]
fn launch_modes_parse_and_print() {
    assert_eq!(LaunchMode::default(), LaunchMode::Real);
    assert_eq!(LAUNCH_MODES, [LaunchMode::Real, LaunchMode::Engine]);
    for mode in LAUNCH_MODES {
        assert_eq!(mode.to_string().parse::<LaunchMode>().unwrap(), mode);
    }
    assert_eq!(LaunchMode::Engine.as_str(), "engine");
    assert_eq!(
        "webdriver".parse::<LaunchMode>().unwrap_err().to_string(),
        "Invalid launch mode: webdriver. Expected 'real' or 'engine'"
    );
}

#[test]
fn launch_options_fantoccini() {
    let options = LaunchOptions::fantoccini();
    assert_eq!(options.engine, EngineType::Fantoccini);
}

#[test]
fn launch_options_playwright_no_longer_slows_every_action() {
    let options = LaunchOptions::playwright();
    assert_eq!(options.engine, EngineType::Playwright);
    assert_eq!(options.slow_mo, 0);
}

#[test]
fn launch_options_puppeteer() {
    let options = LaunchOptions::puppeteer();
    assert_eq!(options.engine, EngineType::Puppeteer);
    assert_eq!(options.slow_mo, 0);
}

#[test]
fn launch_options_node_bridge_configuration() {
    let options = LaunchOptions::playwright()
        .node_executable("/custom/node")
        .node_working_dir("/project/js")
        .channel("chrome-beta")
        .executable_path("/opt/google/chrome-beta");

    assert_eq!(options.node_executable, Some(PathBuf::from("/custom/node")));
    assert_eq!(options.node_working_dir, Some(PathBuf::from("/project/js")));
    assert_eq!(options.channel.as_deref(), Some("chrome-beta"));
    assert_eq!(
        options.executable_path,
        Some(PathBuf::from("/opt/google/chrome-beta"))
    );
}

#[test]
fn all_chrome_args_adds_no_defaults() {
    // The old CHROME_ARGS defaults are the legacy-defaults preset now.
    assert_eq!(
        LaunchOptions::default().all_chrome_args().unwrap(),
        [AUTOMATION_CONTROLLED_OFF_ARG.to_string()]
    );
    assert!(LaunchOptions::default()
        .automation_parity(false)
        .all_chrome_args()
        .unwrap()
        .is_empty());
}

#[test]
fn all_chrome_args_puts_restrictions_before_the_caller_args() {
    let options = LaunchOptions::default()
        .restrictions(["basic-password-store"])
        .with_args(vec!["--legacy-arg".to_string()])
        .with_extra_args(vec!["--lang=en-US".to_string()]);

    assert_eq!(
        options.all_chrome_args().unwrap(),
        [
            "--password-store=basic".to_string(),
            "--legacy-arg".to_string(),
            "--lang=en-US".to_string(),
            AUTOMATION_CONTROLLED_OFF_ARG.to_string()
        ]
    );
}

#[test]
fn all_chrome_args_merges_repeated_feature_switches() {
    let options = LaunchOptions::default()
        .automation_parity(false)
        .with_args(vec!["--disable-features=A".to_string()])
        .with_extra_args(vec!["--disable-features=B".to_string()]);

    assert_eq!(
        options.all_chrome_args().unwrap(),
        ["--disable-features=A,B".to_string()]
    );
}

#[test]
fn all_chrome_args_refuses_an_unknown_restriction() {
    let error = LaunchOptions::default()
        .restrictions(["no-such-restriction"])
        .all_chrome_args()
        .unwrap_err();
    assert!(
        error.to_string().contains("no-such-restriction"),
        "unexpected message: {error}"
    );
}

#[test]
fn ignore_default_args_no_longer_filters_the_command_line() {
    let options = LaunchOptions::default()
        .with_args(vec!["--no-first-run".to_string()])
        .ignore_default_args(vec!["--no-first-run".to_string()]);

    assert!(options
        .all_chrome_args()
        .unwrap()
        .contains(&"--no-first-run".to_string()));
}

#[test]
fn all_chrome_args_leaves_the_command_line_alone_when_parity_is_off() {
    let args = LaunchOptions::default()
        .automation_parity(false)
        .with_args(vec!["--custom".to_string()])
        .all_chrome_args()
        .unwrap();
    assert_eq!(args, ["--custom".to_string()]);
}

#[test]
fn all_ignored_default_args_merges_parity_with_the_caller_list() {
    let options = LaunchOptions::playwright()
        .headless(true)
        .ignore_default_args(vec!["--no-first-run".to_string()]);

    assert_eq!(
        options.all_ignored_default_args(),
        [
            "--enable-automation".to_string(),
            PLAYWRIGHT_SOFTWARE_WEBGL_ARG.to_string(),
            PLAYWRIGHT_HEADLESS_POINTER_ARG.to_string(),
            "--no-first-run".to_string()
        ]
    );
}

#[test]
fn all_ignored_default_args_does_not_repeat_a_switch_the_caller_already_listed() {
    let options =
        LaunchOptions::playwright().ignore_default_args(vec!["--enable-automation".to_string()]);

    assert_eq!(
        options.all_ignored_default_args(),
        [
            "--enable-automation".to_string(),
            PLAYWRIGHT_SOFTWARE_WEBGL_ARG.to_string()
        ]
    );
}

#[test]
fn all_ignored_default_args_keeps_only_the_caller_list_when_parity_is_off() {
    let options = LaunchOptions::playwright()
        .headless(true)
        .automation_parity(false)
        .ignore_default_args(vec!["--no-first-run".to_string()]);

    assert_eq!(
        options.all_ignored_default_args(),
        ["--no-first-run".to_string()]
    );
}

#[test]
fn chromiumoxide_excludes_nothing_by_default() {
    assert!(LaunchOptions::chromiumoxide()
        .all_ignored_default_args()
        .is_empty());
}

#[test]
fn browser_env_is_none_without_restrictions_or_env() {
    assert_eq!(LaunchOptions::default().browser_env().unwrap(), None);
}

#[test]
fn browser_env_layers_the_caller_env_over_the_restrictions() {
    let options = LaunchOptions::default()
        .restrictions(["no-google-services"])
        .env(HashMap::from([
            ("GOOGLE_API_KEY".to_string(), "mine".to_string()),
            ("TZ".to_string(), "UTC".to_string()),
        ]));

    let env = options.browser_env().unwrap().unwrap();

    assert_eq!(env["GOOGLE_API_KEY"], "mine");
    assert_eq!(env["GOOGLE_DEFAULT_CLIENT_ID"], "no");
    assert_eq!(env["TZ"], "UTC");
}

#[test]
fn an_empty_env_is_still_forwarded() {
    let options = LaunchOptions::default().env(HashMap::new());
    assert_eq!(options.browser_env().unwrap(), Some(HashMap::new()));
}

#[test]
fn real_browser_options_carry_the_launch() {
    let options = LaunchOptions::playwright()
        .headless(true)
        .sandbox(false)
        .channel("msedge")
        .user_data_dir("/tmp/bc-profile")
        .remote_debugging_port(9333)
        .restrictions(["no-sync"])
        .with_args(vec!["--custom".to_string()])
        .with_extra_args(vec!["--lang=en-US".to_string()])
        .slow_mo(25)
        .launch_timeout(Duration::from_secs(7))
        .node_working_dir("/project/js");

    let real = options.real_browser_options();

    assert_eq!(real.engine, EngineType::Playwright);
    assert_eq!(real.channel, "msedge");
    assert_eq!(real.user_data_dir, Some(PathBuf::from("/tmp/bc-profile")));
    assert_eq!(real.remote_debugging_port, Some(9333));
    assert!(real.headless);
    assert_eq!(real.restrictions, vec!["no-sync"]);
    assert_eq!(real.args, vec!["--custom"]);
    assert_eq!(real.extra_args, vec!["--lang=en-US", "--no-sandbox"]);
    assert_eq!(real.slow_mo, 25);
    assert_eq!(real.startup_timeout, Duration::from_secs(7));
    assert_eq!(real.node_working_dir, Some(PathBuf::from("/project/js")));
}

#[test]
fn real_browser_options_default_to_chrome() {
    let real = LaunchOptions::default().real_browser_options();
    let defaults = RealBrowserOptions::default();

    assert_eq!(real.channel, "chrome");
    assert!(real.extra_args.is_empty());
    assert_eq!(real.remote_debugging_port, None);
    assert_eq!(real.startup_timeout, defaults.startup_timeout);
}

#[test]
#[allow(deprecated)]
fn get_user_data_dir_uses_custom() {
    let options = LaunchOptions::default().user_data_dir("/custom/path");
    assert_eq!(options.get_user_data_dir(), PathBuf::from("/custom/path"));
}

#[test]
#[allow(deprecated)]
fn get_user_data_dir_creates_default() {
    let options = LaunchOptions::default();
    let dir = options.get_user_data_dir();
    assert!(dir.to_string_lossy().contains("browser-commander"));
    assert!(dir.to_string_lossy().contains("chromiumoxide-data"));
}

#[tokio::test]
async fn launch_fantoccini_owns_a_native_driver() {
    let mut options = LaunchOptions::fantoccini();
    options.webdriver.driver_executable =
        Some("/nonexistent/browser-commander/chromedriver".into());
    let err = launch_browser(options).await.unwrap_err();
    assert!(err.to_string().contains("start WebDriver"), "{err}");
}

#[tokio::test]
async fn launch_refuses_an_unknown_restriction_before_starting_anything() {
    let options = LaunchOptions::chromiumoxide()
        .headless(true)
        .executable_path("/nonexistent/browser-commander/chrome")
        .restrictions(["no-such-restriction"]);

    let err = launch_browser(options).await.unwrap_err();

    assert!(
        err.to_string().contains("no-such-restriction"),
        "unexpected message: {err}"
    );
}

#[test]
fn launch_options_carry_a_fingerprint_profile() {
    let profile = create_default_fingerprint_preset("windows-chrome").expect("preset");
    let options = LaunchOptions::default().fingerprint(profile.clone());

    assert_eq!(options.fingerprint, Some(profile));
}

#[tokio::test]
async fn launch_playwright_fallback_refuses_a_fingerprint_it_cannot_apply() {
    // Dropping the profile silently would leave the page reporting the real
    // machine while the caller believes it is hidden.
    for launch in LAUNCH_MODES {
        let options = LaunchOptions::playwright()
            .playwright_bridge(true)
            .headless(true)
            .launch(launch)
            .fingerprint(create_default_fingerprint_preset("windows-chrome").expect("preset"));

        let err = launch_browser(options).await.unwrap_err();

        assert!(err.to_string().contains("cannot apply fingerprints"));
    }
}

#[test]
fn launch_options_carry_a_download_setting() {
    assert!(matches!(
        LaunchOptions::default().downloads,
        DownloadSetting::Off
    ));
    assert!(matches!(
        LaunchOptions::default().downloads(true).downloads,
        DownloadSetting::On
    ));

    let configured = LaunchOptions::default()
        .downloads(crate::downloads::DownloadOptions::default().directory("/tmp/bc-downloads"));
    let DownloadSetting::Options(options) = configured.downloads else {
        panic!("the caller's download options were dropped");
    };
    assert_eq!(options.directory.as_deref(), Some("/tmp/bc-downloads"));
}

#[tokio::test]
async fn launch_playwright_fallback_refuses_downloads_it_cannot_manage() {
    // Accepting the setting silently would leave the caller waiting on a
    // manager watching a directory the browser never writes into.
    let options = LaunchOptions::playwright()
        .playwright_bridge(true)
        .headless(true)
        .downloads(true);

    let err = launch_browser(options).await.unwrap_err();

    assert!(
        err.to_string()
            .contains("cannot apply fingerprints or managed downloads"),
        "unexpected message: {err}"
    );
}

#[tokio::test]
async fn engine_launch_reports_missing_node_executable() {
    let options = LaunchOptions::playwright()
        .launch(LaunchMode::Engine)
        .headless(true)
        .node_executable("browser-commander-missing-node");
    let err = launch_browser(options).await.unwrap_err();
    assert!(err.to_string().contains("start official Playwright driver"));
}

#[tokio::test]
async fn engine_launch_leaves_a_given_profile_in_place_on_failure() {
    let profile = crate::browser::profile_directory::create_temporary_user_data_dir(None).unwrap();
    let options = LaunchOptions::playwright()
        .launch(LaunchMode::Engine)
        .headless(true)
        .user_data_dir(&profile)
        .node_executable("browser-commander-missing-node");

    launch_browser(options).await.unwrap_err();

    assert!(profile.is_dir(), "the caller's profile was deleted");
    crate::browser::profile_directory::remove_user_data_dir(&profile)
        .await
        .unwrap();
}

#[tokio::test]
async fn real_launch_reports_a_missing_executable() {
    let options = LaunchOptions::chromiumoxide()
        .headless(true)
        .executable_path("/nonexistent/browser-commander/chrome");

    let err = launch_browser(options).await.unwrap_err();

    assert!(
        err.to_string()
            .contains("/nonexistent/browser-commander/chrome"),
        "unexpected message: {err}"
    );
}
