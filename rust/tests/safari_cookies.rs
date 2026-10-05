// feature-parity: sources.safari-cookies@native-typed
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use browser_commander::browser::migration::{
    migrate_profile, MigrateProfileOptions, MigrationSource,
};
use browser_commander::{
    list_browser_profiles, list_cookie_sources, read_browser_cookies, resolve_import_source,
    BrowserCookie, BrowserCookieReadOptions, BrowserProfileOptions, Environment,
};

const DATA: &[u8] = include_bytes!("../../tests/fixtures/safari/Cookies.binarycookies");
const EXPECTED: &str = include_str!("../../tests/fixtures/safari/expected.json");

struct Home(PathBuf);
impl Home {
    fn new() -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        loop {
            let home = std::env::temp_dir().join(format!(
                "bc-safari-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&home) {
                Ok(()) => return Self(home),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("Could not reserve a Safari fixture home: {error}"),
            }
        }
    }
    fn install(&self, browser: &str, legacy: bool) -> PathBuf {
        let bundle = if browser == "safari" {
            "com.apple.Safari"
        } else {
            "com.apple.SafariTechnologyPreview"
        };
        let root = if legacy {
            self.0.join("Library")
        } else {
            self.0
                .join("Library/Containers")
                .join(bundle)
                .join("Data/Library")
        };
        fs::create_dir_all(root.join("Cookies")).unwrap();
        fs::write(root.join("Cookies/Cookies.binarycookies"), DATA).unwrap();
        root
    }
}
impl Drop for Home {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn read(home: &Path, browser: &str) -> Vec<BrowserCookie> {
    read_browser_cookies(
        BrowserCookieReadOptions::new(browser)
            .platform("darwin")
            .home_dir(home)
            .environment(Environment::new())
            .cache(false),
    )
    .unwrap()
}

#[test]
fn installed_variants_and_legacy_path_decode_shared_fixture_without_modifying_source() {
    let expected: Vec<BrowserCookie> = serde_json::from_str(EXPECTED).unwrap();
    for (browser, legacy) in [
        ("safari", false),
        ("safari-technology-preview", false),
        ("safari", true),
    ] {
        let home = Home::new();
        let root = home.install(browser, legacy);
        let profiles = list_browser_profiles(
            BrowserProfileOptions::default()
                .browser(browser)
                .platform("darwin")
                .home_dir(&home.0)
                .environment(Environment::new()),
        )
        .unwrap();
        assert_eq!(profiles[0].path, root);
        assert_eq!(read(&home.0, browser), expected);
        assert_eq!(
            fs::read(root.join("Cookies/Cookies.binarycookies")).unwrap(),
            DATA
        );
    }
}

#[test]
fn listing_does_not_decode_cookie_values() {
    let home = Home::new();
    let root = home.install("safari", false);
    let mut damaged = DATA.to_vec();
    let value_offset = u32::from_le_bytes(damaged[68..72].try_into().unwrap()) as usize;
    damaged[40 + value_offset] = 0xff;
    fs::write(root.join("Cookies/Cookies.binarycookies"), &damaged).unwrap();
    let sources = list_cookie_sources(
        &["GITHUB.COM".into()],
        "darwin",
        &home.0,
        &Environment::new(),
    )
    .unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].cookies, Some(4));
    assert_eq!(sources[0].by_domain.as_ref().unwrap()["GITHUB.COM"], 2);
    assert!(!serde_json::to_string(&sources)
        .unwrap()
        .contains("fixture-token"));
}

#[test]
fn catalogue_error_preserves_readable_profiles() {
    let home = Home::new();
    let root = home.install("safari", false);
    fs::create_dir(root.join("Safari")).unwrap();
    let tabs = root.join("Safari/SafariTabs.db");
    rusqlite::Connection::open(&tabs).unwrap().close().unwrap();
    let chromium = home
        .0
        .join("Library/Application Support/Google/Chrome/Default");
    fs::create_dir_all(&chromium).unwrap();
    let db = rusqlite::Connection::open(chromium.join("Cookies")).unwrap();
    db.execute_batch(
        "CREATE TABLE cookies(host_key TEXT); INSERT INTO cookies VALUES ('.github.com')",
    )
    .unwrap();
    drop(db);
    let before = fs::read(&tabs).unwrap();
    let profiles = list_browser_profiles(
        BrowserProfileOptions::default()
            .platform("darwin")
            .home_dir(&home.0)
            .environment(Environment::new()),
    )
    .unwrap();
    assert_eq!(profiles.iter().filter(|p| p.browser == "safari").count(), 2);
    let sources = list_cookie_sources(
        &["github.com".into()],
        "darwin",
        &home.0,
        &Environment::new(),
    )
    .unwrap();
    assert_eq!(
        sources
            .iter()
            .find(|s| s.browser == "chrome")
            .unwrap()
            .cookies,
        Some(1)
    );
    assert_eq!(
        sources
            .iter()
            .find(|s| s.browser == "safari" && s.error.is_none())
            .unwrap()
            .cookies,
        Some(4)
    );
    assert!(sources
        .iter()
        .find(|s| s.browser == "safari" && s.error.is_some())
        .unwrap()
        .error
        .as_ref()
        .unwrap()
        .contains("no such table"));
    assert_eq!(fs::read(tabs).unwrap(), before);
}

#[test]
fn discovery_domains_are_exact_and_reader_filter_stays_substring() {
    let home = Home::new();
    home.install("safari", false);
    let sources = list_cookie_sources(
        &["hub.com".into(), "github.co".into()],
        "darwin",
        &home.0,
        &Environment::new(),
    )
    .unwrap();
    assert!(sources.is_empty());
    let cookies = read_browser_cookies(
        BrowserCookieReadOptions::new("safari")
            .platform("darwin")
            .home_dir(&home.0)
            .environment(Environment::new())
            .domain_filter("hub.com")
            .cache(false),
    )
    .unwrap();
    let expected: Vec<BrowserCookie> = serde_json::from_str(EXPECTED).unwrap();
    assert_eq!(cookies, expected[..2]);
}

#[test]
fn default_domain_migration_reports_unsupported_classes_without_keychain_access() {
    let home = Home::new();
    home.install("safari", false);
    let runner = Arc::new(|_: &str, _: &[&str], _: &Environment| {
        Ok(
            "( { LSHandlerURLScheme = https; LSHandlerRoleAll = \"com.apple.Safari\"; } )"
                .to_string(),
        )
    });
    let source = resolve_import_source(
        "default",
        &["github.com".into()],
        "darwin",
        &home.0,
        &Environment::new(),
        Some(&(runner.clone() as _)),
    )
    .unwrap();
    assert_eq!(source.browser, "safari");
    assert!(source.warning.is_none());
    let report = migrate_profile(
        MigrateProfileOptions::new(MigrationSource::new("auto"), home.0.join("target"))
            .platform("darwin")
            .home_dir(&home.0)
            .environment(Environment::new())
            .domains(["github.com", "GITHUB.COM"])
            .run_command(runner),
    )
    .unwrap();
    let expected: Vec<BrowserCookie> = serde_json::from_str(EXPECTED).unwrap();
    assert_eq!(report.cookies, expected[..2]);
    assert_eq!(report.migrated.cookies, 2);
    assert_eq!(report.skipped.len(), 5);
    assert_eq!(
        report
            .skipped
            .iter()
            .find(|item| item.data_class == "passwords")
            .unwrap()
            .reason,
        "safari-password-export-required"
    );
    assert!(report
        .warnings
        .iter()
        .any(|item| item.reason == "safari-samesite-unavailable"));
}

#[test]
fn explicit_profile_directory_filters_domains() {
    let home = Home::new();
    let root = home.install("safari", false);
    let cookies = read_browser_cookies(
        BrowserCookieReadOptions::new("safari")
            .profile_dir(root)
            .domain_filter("github.com")
            .home_dir(home.0.join("empty"))
            .cache(false),
    )
    .unwrap();
    let expected: Vec<BrowserCookie> = serde_json::from_str(EXPECTED).unwrap();
    assert_eq!(cookies, expected[..2]);
}

#[test]
fn unreadable_default_preserves_source_error() {
    let home = Home::new();
    let root = home.install("safari", false);
    fs::write(root.join("Cookies/Cookies.binarycookies"), b"corrupt").unwrap();
    let sources = list_cookie_sources(
        &["github.com".into()],
        "darwin",
        &home.0,
        &Environment::new(),
    )
    .unwrap();
    assert!(sources[0]
        .error
        .as_ref()
        .unwrap()
        .contains("Invalid Safari binarycookies"));
    let runner: browser_commander::RunCommand = Arc::new(|_, _, _| {
        Ok(
            "( { LSHandlerURLScheme = https; LSHandlerRoleAll = \"com.apple.Safari\"; } )"
                .to_string(),
        )
    });
    let error = resolve_import_source(
        "default",
        &["github.com".into()],
        "darwin",
        &home.0,
        &Environment::new(),
        Some(&runner),
    )
    .unwrap_err()
    .to_string();
    assert!(
        error.contains("Could not inspect the default browser"),
        "{error}"
    );
    assert!(error.contains("Invalid Safari binarycookies"), "{error}");
}
