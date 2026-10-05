//! Firefox cookie expiry units are schema-dependent in every read path.

use std::fs;

use browser_commander::browser::migration::{
    migrate_profile, MigrateProfileOptions, MigrationSource,
};
use browser_commander::{read_browser_cookies, BrowserCookieReadOptions, Environment};
use rusqlite::Connection;

#[test]
fn installed_firefox_cookie_expiry_units() -> anyhow::Result<()> {
    verify_expiry(false)
}

#[test]
fn migrated_firefox_cookie_expiry_units() -> anyhow::Result<()> {
    verify_expiry(true)
}

fn verify_expiry(migration: bool) -> anyhow::Result<()> {
    let home = std::env::temp_dir().join(format!(
        "bc-ff-expiry-{}-{}",
        std::process::id(),
        if migration { "migration" } else { "reader" }
    ));
    fs::create_dir(&home)?;
    let result = (|| {
        for version in [0, 15, 16, 17] {
            let root = home.join(version.to_string()).join(".mozilla/firefox");
            let source = root.join("expiry.default-release");
            fs::create_dir_all(&source)?;
            fs::write(
                root.join("profiles.ini"),
                "[Profile0]\nName=default-release\nIsRelative=1\nPath=expiry.default-release\nDefault=1\n",
            )?;
            let file = source.join("cookies.sqlite");
            let database = Connection::open(&file)?;
            database.execute_batch(include_str!(
                "../../tests/fixtures/firefox-cookie-expiry.sql"
            ))?;
            database.pragma_update(None, "user_version", version)?;
            if version >= 16 {
                database.execute(
                    "UPDATE moz_cookies SET expiry = expiry * 1000 + 999 WHERE expiry > 0",
                    [],
                )?;
            }
            drop(database);
            let before = fs::read(&file)?;
            let fixture_home = home.join(version.to_string());
            let cookies = if migration {
                let report = migrate_profile(
                    MigrateProfileOptions::new(
                        MigrationSource::new("firefox").user_data_dir(&source),
                        fixture_home.join("target"),
                    )
                    .include(["cookies"])
                    .domains(["expiry.example"])
                    .platform("linux")
                    .home_dir(&fixture_home)
                    .environment(Environment::new()),
                )?;
                assert_eq!(report.migrated.cookies, 3);
                report.cookies
            } else {
                read_browser_cookies(
                    BrowserCookieReadOptions::new("firefox")
                        .domain_filter("expiry.example")
                        .cache(false)
                        .platform("linux")
                        .home_dir(&fixture_home)
                        .environment(Environment::new()),
                )?
            };
            assert_eq!(cookies.len(), 3);
            for cookie in cookies {
                let expected = if cookie.name == "persistent" {
                    2_000_000_001
                } else {
                    -1
                };
                assert!(
                    cookie.expires == expected,
                    "expiry normalization failed for schema {version}"
                );
            }
            assert_eq!(fs::read(file)?, before);
        }
        Ok(())
    })();
    fs::remove_dir_all(&home)?;
    result
}
