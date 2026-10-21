//! Unit tests for [`super`], mirroring
//! `js/tests/unit/browser/launch-executable.test.js` (issue #179).
// feature-parity: launch.chrome-for-testing@native-typed

use std::fs;

use super::*;
use crate::browser::browser_cookie_sources::tests::TempDir;
use crate::browser::restrictions::resolve_restrictions;

/// Create an executable file at `relative` under `root`.
fn executable(root: &Path, relative: &str) -> PathBuf {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    path
}

#[test]
fn recognises_every_chrome_for_testing_layout() {
    for path in [
        "/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
        "/Users/u/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        r"C:\Users\u\AppData\Local\ms-playwright\chromium-1248\chrome-win64\chrome.exe",
        "/home/u/.cache/puppeteer/chrome/linux-131.0.6778.85/chrome-linux64/chrome",
        "/Users/u/.cache/puppeteer/chrome/mac_arm-131.0.6778.85/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/home/u/.cache/selenium/chrome/linux64/131.0.6778.85/chrome",
        r"C:\Users\u\.cache\selenium\chrome\win64\131.0.6778.85\chrome.exe",
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ] {
        assert!(is_chrome_for_testing(path), "{path}");
    }
}

#[test]
fn does_not_take_other_browsers_for_chrome_for_testing() {
    for path in [
        "/opt/google/chrome/chrome",
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "/usr/bin/chromium",
        // Playwright's own Chromium builds predate Chrome for Testing.
        "/home/u/.cache/ms-playwright/chromium-1100/chrome-linux/chrome",
        "/Users/u/Library/Caches/ms-playwright/chromium-1100/chrome-mac/Chromium.app/Contents/MacOS/Chromium",
        "/home/u/.cache/selenium/firefox/linux64/133.0/firefox",
        "/home/u/.cache/selenium/chrome/linux",
    ] {
        assert!(!is_chrome_for_testing(path), "{path}");
    }
}

#[test]
fn the_preset_hides_the_infobar_and_the_keychain_prompts() {
    assert_eq!(
        chrome_for_testing_restrictions(),
        ["no-chrome-for-testing-infobar", "mock-keychain"]
    );
    let resolved = resolve_restrictions(&[CHROME_FOR_TESTING_PRESET]).unwrap();
    assert_eq!(resolved.args, ["--test-type=gpu", "--use-mock-keychain"]);
}

#[test]
fn defaults_apply_to_chrome_for_testing_only_unless_replaced() {
    let cft = "/home/u/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome";
    assert_eq!(
        default_restrictions_for(cft, None),
        chrome_for_testing_restrictions()
    );
    assert!(default_restrictions_for("/opt/google/chrome/chrome", None).is_empty());
    assert!(default_restrictions_for(cft, Some(&[])).is_empty());
    let only = ["mock-keychain".to_string()];
    assert_eq!(
        default_restrictions_for("/opt/google/chrome/chrome", Some(&only)),
        only
    );
}

#[test]
fn starts_chrome_for_testing_unless_a_channel_or_path_is_chosen() {
    let temp = TempDir::new("bc-cft-");
    let cft = executable(temp.path(), "chrome-linux64/chrome");
    let system = |_: &RealBrowserOptions| Ok(PathBuf::from("/opt/google/chrome/chrome"));
    let bundled = |_: &RealBrowserOptions| Some(cft.clone());

    let default = RealBrowserOptions::default();
    assert_eq!(
        resolve_launch_executable_with(&default, system, bundled).unwrap(),
        cft
    );
    for chosen in [
        RealBrowserOptions::default().channel("chrome"),
        RealBrowserOptions::default().executable_path("/opt/google/chrome/chrome"),
    ] {
        assert_eq!(
            resolve_launch_executable_with(&chosen, system, bundled).unwrap(),
            PathBuf::from("/opt/google/chrome/chrome")
        );
    }
}

#[test]
fn never_falls_back_to_google_chrome_without_chrome_for_testing() {
    let system = |_: &RealBrowserOptions| -> Result<PathBuf> { panic!("Google Chrome was used") };
    for (engine, install) in [
        (EngineType::Playwright, "npx playwright install chromium"),
        (
            EngineType::Puppeteer,
            "npx puppeteer browsers install chrome",
        ),
        (EngineType::Chromiumoxide, "npx @puppeteer/browsers install"),
    ] {
        let options = RealBrowserOptions {
            engine,
            ..Default::default()
        };
        let missing = resolve_launch_executable_with(&options, system, |_| None)
            .unwrap_err()
            .to_string();
        assert!(
            missing.contains("Chrome for Testing is not installed"),
            "{missing}"
        );
        assert!(missing.contains(install), "{missing}");
        assert!(missing.contains("channel(\"chrome\")"), "{missing}");
        // A reported path that is not there is not installed either.
        let gone =
            |_: &RealBrowserOptions| Some(PathBuf::from("/nonexistent/chrome-linux64/chrome"));
        assert!(resolve_launch_executable_with(&options, system, gone).is_err());
    }
}

#[test]
fn finds_the_newest_download_in_each_cache() {
    let temp = TempDir::new("bc-cft-caches-");
    let root = temp.path();
    executable(root, "ms-playwright/chromium-999/chrome-linux64/chrome");
    let playwright = executable(root, "ms-playwright/chromium-1248/chrome-linux64/chrome");
    // Older Playwright Chromium builds are not Chrome for Testing.
    executable(root, "ms-playwright/chromium-2000/chrome-linux/chrome");
    let puppeteer = executable(
        root,
        "puppeteer/chrome/linux-131.0.6778.85/chrome-linux64/chrome",
    );
    executable(root, "puppeteer/chrome/linux-99.0.1/chrome-linux64/chrome");
    let selenium = executable(root, "selenium/chrome/linux64/131.0.6778.85/chrome");
    executable(root, "selenium/chrome/linux64/9.0.1/chrome");
    let caches = DownloadCaches {
        playwright: Some(root.join("ms-playwright")),
        puppeteer: Some(root.join("puppeteer")),
        selenium: Some(root.join("selenium")),
    };

    assert_eq!(
        caches.find(&[CacheSource::Playwright], "linux"),
        Some(playwright.clone())
    );
    assert_eq!(
        caches.find(&[CacheSource::Puppeteer], "linux"),
        Some(puppeteer)
    );
    assert_eq!(
        caches.find(&[CacheSource::Selenium], "linux"),
        Some(selenium.clone())
    );
    assert_eq!(
        caches.find(&[CacheSource::Selenium, CacheSource::Playwright], "linux"),
        Some(selenium)
    );
    assert_eq!(caches.find(&[CacheSource::Playwright], "windows"), None);
    assert_eq!(
        DownloadCaches::default().find(&[CacheSource::Playwright], "linux"),
        None
    );
    assert!(is_chrome_for_testing(playwright));
}

#[test]
fn finds_the_macos_application_bundle() {
    let temp = TempDir::new("bc-cft-mac-");
    let app = executable(
        temp.path(),
        &format!("chromium-1248/chrome-mac-x64/{MAC_EXECUTABLE}"),
    );
    let caches = DownloadCaches {
        playwright: Some(temp.path().to_path_buf()),
        ..Default::default()
    };
    assert_eq!(caches.find(&[CacheSource::Playwright], "macos"), Some(app));
}

#[test]
fn pairs_chrome_for_testing_with_the_chromedriver_of_its_release() {
    let temp = TempDir::new("bc-cft-driver-");
    let root = temp.path();
    let selenium = executable(root, "selenium/chrome/linux64/131.0.6778.85/chrome");
    let selenium_driver = executable(
        root,
        "selenium/chromedriver/linux64/131.0.6778.85/chromedriver",
    );
    executable(root, "selenium/chromedriver/linux64/130.0.1/chromedriver");
    assert_eq!(matching_chromedriver(&selenium), Some(selenium_driver));

    let puppeteer = executable(
        root,
        "puppeteer/chrome/linux-131.0.6778.85/chrome-linux64/chrome",
    );
    let puppeteer_driver = executable(
        root,
        "puppeteer/chromedriver/linux-131.0.6778.85/chromedriver-linux64/chromedriver",
    );
    assert_eq!(matching_chromedriver(&puppeteer), Some(puppeteer_driver));

    // Another release's chromedriver cannot drive it.
    let unmatched = executable(root, "selenium/chrome/linux64/132.0.1/chrome");
    assert_eq!(matching_chromedriver(&unmatched), None);
    let playwright = executable(root, "ms-playwright/chromium-1248/chrome-linux64/chrome");
    assert_eq!(matching_chromedriver(&playwright), None);
}
