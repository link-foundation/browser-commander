//! Unit tests for the browser an engine launch starts (issue #179).

use super::*;
use crate::browser::chrome_for_testing::chrome_for_testing_restrictions;
use crate::browser::webdriver::WebDriverBrowser;

const PLAYWRIGHT_CFT: &str = "/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
const SELENIUM_CFT: &str = "/home/u/.cache/selenium/chrome/linux64/131.0.6778.85/chrome";

fn no_bundle(_: &LaunchOptions) -> Option<PathBuf> {
    None
}

fn cached(engine: EngineType) -> Vec<PathBuf> {
    assert!(
        matches!(engine, EngineType::Chromiumoxide | EngineType::Fantoccini),
        "{engine}"
    );
    vec![PLAYWRIGHT_CFT.into(), SELENIUM_CFT.into()]
}

#[test]
fn chromiumoxide_starts_the_newest_cached_chrome_for_testing() {
    let options = LaunchOptions::chromiumoxide();
    let executable = engine_executable(&options, cached, no_bundle).unwrap();
    assert_eq!(executable, Some(PathBuf::from(PLAYWRIGHT_CFT)));
    let (effective, webdriver_browser, defaults) = engine_launch_options(&options, executable);
    // Without it chromiumoxide would detect the installed Google Chrome.
    assert_eq!(
        effective.executable_path,
        Some(PathBuf::from(PLAYWRIGHT_CFT))
    );
    assert_eq!(webdriver_browser, None);
    assert_eq!(defaults, chrome_for_testing_restrictions());
    assert_eq!(effective.restrictions, chrome_for_testing_restrictions());
}

#[test]
fn chromiumoxide_without_chrome_for_testing_never_falls_back_to_google_chrome() {
    let error = engine_executable(&LaunchOptions::chromiumoxide(), |_| Vec::new(), no_bundle)
        .unwrap_err()
        .to_string();
    assert!(
        error.starts_with("Chrome for Testing is not installed for chromiumoxide"),
        "{error}"
    );
    assert!(error.contains("channel \"chrome\""), "{error}");
}

#[test]
fn a_channel_or_an_executable_is_started_as_given() {
    let never = |_: EngineType| -> Vec<PathBuf> { panic!("no cache is searched") };
    let chrome = LaunchOptions::chromiumoxide().channel("chrome");
    assert_eq!(engine_executable(&chrome, never, no_bundle).unwrap(), None);
    let (effective, _, defaults) = engine_launch_options(&chrome, None);
    assert_eq!(effective.executable_path, None);
    assert!(defaults.is_empty());

    let path = LaunchOptions::chromiumoxide().executable_path("/opt/google/chrome/chrome");
    let executable = engine_executable(&path, never, no_bundle).unwrap();
    assert_eq!(executable, Some(PathBuf::from("/opt/google/chrome/chrome")));
    let (effective, _, defaults) = engine_launch_options(&path, executable);
    assert_eq!(
        effective.executable_path,
        Some(PathBuf::from("/opt/google/chrome/chrome"))
    );
    assert!(defaults.is_empty());
}

#[test]
fn fantoccini_prefers_a_download_it_has_the_chromedriver_of() {
    let temp = crate::browser::browser_cookie_sources::tests::TempDir::new("bc-engine-driver-");
    let make = |relative: &str| {
        let path = temp.path().join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    };
    let playwright = make("ms-playwright/chromium-1248/chrome-linux64/chrome");
    let selenium = make("selenium/chrome/linux64/131.0.6778.85/chrome");
    make("selenium/chromedriver/linux64/131.0.6778.85/chromedriver");
    let options = LaunchOptions::fantoccini();
    let executable = engine_executable(
        &options,
        |_| vec![playwright.clone(), selenium.clone()],
        no_bundle,
    )
    .unwrap();
    // Playwright downloads no chromedriver, and the one on PATH belongs to
    // the installed Google Chrome.
    assert_eq!(executable, Some(selenium.clone()));
    let (effective, webdriver_browser, defaults) = engine_launch_options(&options, executable);
    assert_eq!(webdriver_browser, Some(selenium));
    assert_eq!(effective.executable_path, None);
    // launch_webdriver adds them for the browser it is given.
    assert!(defaults.is_empty());

    let mut firefox = LaunchOptions::fantoccini();
    firefox.webdriver.browser = WebDriverBrowser::Firefox;
    assert_eq!(
        engine_executable(&firefox, cached, no_bundle).unwrap(),
        None
    );
}

#[test]
fn playwright_and_puppeteer_report_their_own_download() {
    for options in [LaunchOptions::playwright(), LaunchOptions::puppeteer()] {
        let executable = engine_executable(
            &options,
            |_| panic!("the Node engine reports its own download"),
            |_| Some(PLAYWRIGHT_CFT.into()),
        )
        .unwrap();
        let (effective, _, defaults) = engine_launch_options(&options, executable);
        // The engine itself picks the binary.
        assert_eq!(effective.executable_path, None);
        assert_eq!(defaults, chrome_for_testing_restrictions());
    }
}

// feature-parity: profile.session-cookies@native-typed
#[test]
fn headless_playwright_keeps_session_cookies_on_the_full_chromium_build() {
    let headless = LaunchOptions::playwright().headless(true);
    let session = playwright_session_options(&headless, Some(true)).unwrap();
    assert_eq!(session.channel.as_deref(), Some("chromium"));
    // A temporary profile, the opt-out and a headful launch change nothing.
    assert!(playwright_session_options(&headless, None).is_none());
    assert!(playwright_session_options(&headless, Some(false)).is_none());
    assert!(playwright_session_options(&headless.clone().headless(false), Some(true)).is_none());
    // A browser the caller picked is started as given.
    let chrome = headless.clone().channel("chrome");
    assert!(playwright_session_options(&chrome, Some(true)).is_none());
    let path = headless.executable_path("/opt/google/chrome/chrome");
    assert!(playwright_session_options(&path, Some(true)).is_none());
    // Puppeteer's headless mode is the full build already.
    let puppeteer = LaunchOptions::puppeteer().headless(true);
    assert!(playwright_session_options(&puppeteer, Some(true)).is_none());
}

#[test]
fn chromiumoxide_gets_each_switch_as_a_key_and_value() {
    // Passed whole, `--restore-last-session` reached Chrome as
    // `----restore-last-session` and session cookies were deleted (#187).
    assert_eq!(
        chromiumoxide_arg("--restore-last-session"),
        ("restore-last-session", None)
    );
    assert_eq!(
        chromiumoxide_arg("--disable-blink-features=AutomationControlled"),
        ("disable-blink-features", Some("AutomationControlled"))
    );
    assert_eq!(
        chromiumoxide_arg("--js-flags=--expose-gc"),
        ("js-flags", Some("--expose-gc"))
    );
    assert_eq!(chromiumoxide_arg("no-first-run"), ("no-first-run", None));
}
