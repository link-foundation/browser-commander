// feature-parity: launch.chrome-for-testing@native-typed
use super::*;
use std::collections::HashMap;

/// A fresh scratch directory, removed when dropped.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("bc-cft-{name}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    /// Create an executable file at `relative`.
    fn binary(&self, relative: &[&str]) -> PathBuf {
        let mut path = self.0.clone();
        path.extend(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn locations(platform: CachePlatform, home: &Path, env: &[(&str, &Path)]) -> CacheLocations {
    CacheLocations {
        platform,
        home: Some(home.to_path_buf()),
        env: env
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string_lossy().into_owned()))
            .collect::<HashMap<_, _>>(),
    }
}

#[test]
fn chrome_for_testing_is_recognised_by_its_install_path() {
    for path in [
        "/home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
        "/home/user/.cache/puppeteer/chrome/linux-131.0.6778.204/chrome-linux64/chrome",
        "/home/user/.cache/selenium/chrome/linux64/131.0.6778.204/chrome",
        r"C:\Users\me\.cache\selenium\chrome\win64\131.0.6778.204\chrome.exe",
        r"C:\Users\me\AppData\Local\ms-playwright\chromium-1248\chrome-win64\chrome.exe",
        "/Users/me/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    ] {
        assert!(is_chrome_for_testing(Path::new(path)), "{path}");
    }
}

#[test]
fn other_browsers_are_not_chrome_for_testing() {
    for path in [
        "/home/user/.cache/ms-playwright/chromium-1100/chrome-linux/chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/usr/bin/google-chrome",
        "/opt/google/chrome/chrome",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        "/home/user/.cache/selenium/chromedriver/linux64/131.0.6778.204/chromedriver",
        "/home/user/selenium/chrome/beta/chrome",
    ] {
        assert!(!is_chrome_for_testing(Path::new(path)), "{path}");
    }
}

#[test]
fn chrome_for_testing_gets_the_preset_by_default() {
    let restrictions = chrome_for_testing_restrictions();
    assert_eq!(
        restrictions,
        ["no-chrome-for-testing-infobar", "mock-keychain"]
    );
    let resolved = crate::browser::restrictions::resolve_restrictions(&restrictions).unwrap();
    assert!(resolved.args.contains(&"--test-type=gpu".to_string()));
    assert!(resolved.args.contains(&"--use-mock-keychain".to_string()));
    assert_eq!(
        default_restrictions_for(
            Path::new("/home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"),
            None
        ),
        restrictions
    );
}

#[test]
fn google_chrome_gets_no_default_restrictions() {
    assert!(default_restrictions_for(Path::new("/usr/bin/google-chrome"), None).is_empty());
}

#[test]
fn requested_default_restrictions_replace_the_automatic_ones() {
    let cft = Path::new("/home/user/.cache/selenium/chrome/linux64/131.0.6778.204/chrome");
    assert!(default_restrictions_for(cft, Some(&[])).is_empty());
    assert_eq!(
        default_restrictions_for(
            Path::new("/usr/bin/google-chrome"),
            Some(&["no-sync".into()])
        ),
        ["no-sync"]
    );
}

#[test]
fn the_newest_playwright_chrome_for_testing_is_found() {
    let home = Scratch::new("playwright");
    home.binary(&[
        ".cache",
        "ms-playwright",
        "chromium-999",
        "chrome-linux64",
        "chrome",
    ]);
    let newest = home.binary(&[
        ".cache",
        "ms-playwright",
        "chromium-1248",
        "chrome-linux64",
        "chrome",
    ]);
    // An old Chromium build and the headless shell are not Chrome for Testing.
    home.binary(&[
        ".cache",
        "ms-playwright",
        "chromium-1300",
        "chrome-linux",
        "chrome",
    ]);
    home.binary(&[
        ".cache",
        "ms-playwright",
        "chromium_headless_shell-1400",
        "chrome-linux64",
        "chrome",
    ]);
    let found =
        locations(CachePlatform::Linux64, &home.0, &[]).find(ChromeForTestingCache::Playwright);
    assert_eq!(found.first(), Some(&newest));
    assert_eq!(found.len(), 2);
}

#[test]
fn playwright_browsers_path_moves_the_cache() {
    let home = Scratch::new("playwright-path");
    let moved = home.binary(&["browsers", "chromium-1248", "chrome-linux64", "chrome"]);
    home.binary(&[
        ".cache",
        "ms-playwright",
        "chromium-1300",
        "chrome-linux64",
        "chrome",
    ]);
    let root = home.0.join("browsers");
    let found = locations(
        CachePlatform::Linux64,
        &home.0,
        &[("PLAYWRIGHT_BROWSERS_PATH", &root)],
    )
    .find(ChromeForTestingCache::Playwright);
    assert_eq!(found, [moved]);
}

#[test]
fn the_newest_puppeteer_chrome_for_testing_is_found() {
    let home = Scratch::new("puppeteer");
    home.binary(&[
        ".cache",
        "puppeteer",
        "chrome",
        "linux-131.0.6778.9",
        "chrome-linux64",
        "chrome",
    ]);
    let newest = home.binary(&[
        ".cache",
        "puppeteer",
        "chrome",
        "linux-131.0.6778.204",
        "chrome-linux64",
        "chrome",
    ]);
    let found =
        locations(CachePlatform::Linux64, &home.0, &[]).find(ChromeForTestingCache::Puppeteer);
    assert_eq!(found.first(), Some(&newest));
    let moved = home.binary(&[
        "pptr",
        "chrome",
        "linux-120.0.1.2",
        "chrome-linux64",
        "chrome",
    ]);
    let root = home.0.join("pptr");
    let found = locations(
        CachePlatform::Linux64,
        &home.0,
        &[("PUPPETEER_CACHE_DIR", &root)],
    )
    .find(ChromeForTestingCache::Puppeteer);
    assert_eq!(found, [moved]);
}

#[test]
fn selenium_manager_chrome_for_testing_is_found() {
    let home = Scratch::new("selenium");
    let chrome = home.binary(&[
        ".cache",
        "selenium",
        "chrome",
        "linux64",
        "131.0.6778.204",
        "chrome",
    ]);
    let found = locations(CachePlatform::Linux64, &home.0, &[]).find_all(&[
        ChromeForTestingCache::Playwright,
        ChromeForTestingCache::Selenium,
    ]);
    assert_eq!(found, [chrome]);
}

#[test]
fn the_mac_binary_is_inside_the_app_bundle() {
    let home = Scratch::new("mac");
    let chrome = home.binary(&[
        "Library",
        "Caches",
        "ms-playwright",
        "chromium-1248",
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
    ]);
    let found =
        locations(CachePlatform::MacArm64, &home.0, &[]).find(ChromeForTestingCache::Playwright);
    assert_eq!(found, [chrome]);
}

#[test]
fn an_empty_cache_finds_nothing() {
    let home = Scratch::new("empty");
    assert!(locations(CachePlatform::Linux64, &home.0, &[])
        .find_all(&[
            ChromeForTestingCache::Playwright,
            ChromeForTestingCache::Puppeteer,
            ChromeForTestingCache::Selenium,
        ])
        .is_empty());
}
