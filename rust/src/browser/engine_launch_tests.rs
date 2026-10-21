//! Unit tests for the engine-launch defaults of issue #179.

use super::*;
use crate::browser::launch_executable::chrome_for_testing_restrictions;
use crate::browser::webdriver::WebDriverBrowser;

const PLAYWRIGHT_CFT: &str = "/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";

fn no_download(_: &RealBrowserOptions) -> Option<PathBuf> {
    None
}

#[test]
fn playwright_and_puppeteer_keep_their_own_chrome_for_testing() {
    for options in [LaunchOptions::playwright(), LaunchOptions::puppeteer()] {
        let (effective, defaults) =
            with_engine_defaults(&options, |_| Some(PLAYWRIGHT_CFT.into())).unwrap();
        assert_eq!(defaults, chrome_for_testing_restrictions());
        assert_eq!(effective.restrictions, chrome_for_testing_restrictions());
        // The engine itself picks the binary.
        assert_eq!(effective.executable_path, None);
    }
}

#[test]
fn a_chosen_channel_or_an_opt_out_adds_nothing() {
    for options in [
        LaunchOptions::playwright().channel("chrome"),
        LaunchOptions::puppeteer().executable_path("/opt/google/chrome/chrome"),
        LaunchOptions::playwright().default_restrictions(Vec::<String>::new()),
    ] {
        let (effective, defaults) =
            with_engine_defaults(&options, |_| Some(PLAYWRIGHT_CFT.into())).unwrap();
        assert!(defaults.is_empty());
        assert!(effective.restrictions.is_empty());
    }
}

#[test]
fn the_defaults_come_before_the_requested_restrictions() {
    let options = LaunchOptions::playwright().restrictions(["no-sync"]);
    let (effective, _) = with_engine_defaults(&options, |_| Some(PLAYWRIGHT_CFT.into())).unwrap();
    assert_eq!(
        effective.restrictions,
        ["no-chrome-for-testing-infobar", "mock-keychain", "no-sync"]
    );
}

#[test]
fn chromiumoxide_starts_a_downloaded_chrome_for_testing() {
    let temp = crate::browser::browser_cookie_sources::tests::TempDir::new("bc-engine-cft-");
    let cft = temp.path().join("chrome-linux64/chrome");
    std::fs::create_dir_all(cft.parent().unwrap()).unwrap();
    std::fs::write(&cft, "").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&cft, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let (effective, defaults) =
        with_engine_defaults(&LaunchOptions::chromiumoxide(), |_| Some(cft.clone())).unwrap();
    assert_eq!(effective.executable_path, Some(cft));
    assert_eq!(defaults, chrome_for_testing_restrictions());

    let missing = with_engine_defaults(&LaunchOptions::chromiumoxide(), no_download)
        .unwrap_err()
        .to_string();
    assert!(
        missing.contains("Chrome for Testing is not installed"),
        "{missing}"
    );
}

#[test]
fn webdriver_uses_the_given_browser_or_none_for_firefox() {
    let mut chrome = LaunchOptions::fantoccini();
    chrome.webdriver.browser_executable = Some(PLAYWRIGHT_CFT.into());
    let (effective, defaults) = with_engine_defaults(&chrome, no_download).unwrap();
    assert_eq!(defaults, chrome_for_testing_restrictions());
    assert_eq!(effective.webdriver.driver_executable, None);

    let mut firefox = LaunchOptions::fantoccini();
    firefox.webdriver.browser = WebDriverBrowser::Firefox;
    let (effective, defaults) = with_engine_defaults(&firefox, no_download).unwrap();
    assert!(defaults.is_empty());
    assert_eq!(effective.executable_path, None);
}

#[test]
fn webdriver_pairs_a_selenium_download_with_its_chromedriver() {
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
    let cft = make("selenium/chrome/linux64/131.0.6778.85/chrome");
    let driver = make("selenium/chromedriver/linux64/131.0.6778.85/chromedriver");
    let (effective, defaults) =
        with_engine_defaults(&LaunchOptions::fantoccini(), |_| Some(cft.clone())).unwrap();
    assert_eq!(effective.executable_path, Some(cft));
    assert_eq!(effective.webdriver.driver_executable, Some(driver));
    assert_eq!(defaults, chrome_for_testing_restrictions());
}
