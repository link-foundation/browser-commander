//! Native Firefox history translation, using the same fixture as JS/Python.

use super::super::{migrate_profile, MigrateProfileOptions, MigrationSource};
use super::fixtures::TempDir;
use rusqlite::Connection;

#[test]
fn translates_visits_with_exact_domains_and_preserves_source() {
    for domains in [vec![], vec!["GITHUB.COM."]] {
        let source = TempDir::new("bc-ff-history-");
        let target_root = TempDir::new("bc-ff-history-");
        let target = target_root.path().join("new-profile");
        let filename = source.path().join("places.sqlite");
        let db = Connection::open(&filename).unwrap();
        db.execute_batch(include_str!(
            "../../../../../tests/fixtures/firefox-history.sql"
        ))
        .unwrap();
        drop(db);
        let before = std::fs::read(&filename).unwrap();
        let count = if domains.is_empty() { 4 } else { 3 };
        let report = migrate_profile(
            MigrateProfileOptions::new(
                MigrationSource::new("firefox").user_data_dir(source.path()),
                &target,
            )
            .include(["history"])
            .domains(domains),
        )
        .unwrap();
        assert_eq!(report.migrated.history, count);
        assert!(report.skipped.is_empty());
        assert_eq!(
            report.warnings[0].reason,
            "firefox-history-metadata-not-translated"
        );
        let db = Connection::open(target.join("History")).unwrap();
        let rows: Vec<(String, String, i64, i64)> = db
            .prepare("SELECT url,title,visit_count,last_visit_time FROM urls ORDER BY url")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            &rows[..2],
            &[
                (
                    "https://docs.github.com/second".into(),
                    "".into(),
                    1,
                    13344473600000003
                ),
                (
                    "https://github.com/first".into(),
                    "First Ω".into(),
                    2,
                    13344473600000002
                ),
            ]
        );
        let times: Vec<i64> = db
            .prepare("SELECT visit_time FROM visits ORDER BY visit_time")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            times,
            [
                13344473600000001,
                13344473600000002,
                13344473600000003,
                13344473600000004
            ][..count as usize]
        );
        assert_eq!(std::fs::read(filename).unwrap(), before);
        assert!(!target.join("places.sqlite").exists());
    }
}

#[test]
fn reports_corrupt_or_overflowing_dates_and_retains_valid_visits() {
    for value in [
        "NULL",
        "'invalid'",
        "1.5",
        "-11644473600000001",
        "9223372036854775807",
    ] {
        let source = TempDir::new("bc-ff-history-");
        let target_root = TempDir::new("bc-ff-history-");
        let filename = source.path().join("places.sqlite");
        let db = Connection::open(&filename).unwrap();
        db.execute_batch(include_str!(
            "../../../../../tests/fixtures/firefox-history.sql"
        ))
        .unwrap();
        db.execute_batch(&format!(
            "INSERT INTO moz_historyvisits VALUES (5,1,{value},1)"
        ))
        .unwrap();
        drop(db);
        let before = std::fs::read(&filename).unwrap();
        let report = migrate_profile(
            MigrateProfileOptions::new(
                MigrationSource::new("firefox").user_data_dir(source.path()),
                target_root.path().join("new-profile"),
            )
            .include(["history"])
            .domains(["github.com"]),
        )
        .unwrap();
        assert_eq!(report.migrated.history, 3);
        assert_eq!(report.skipped.len(), 1);
        assert_eq!(report.skipped[0].reason, "invalid-history-timestamp");
        assert_eq!(report.skipped[0].item, "places.sqlite visit 5");
        assert_eq!(std::fs::read(filename).unwrap(), before);
    }
}

#[test]
fn reports_missing_visit_table_before_creating_target() {
    let source = TempDir::new("bc-ff-history-");
    let target_root = TempDir::new("bc-ff-history-");
    let target = target_root.path().join("new-profile");
    let db = Connection::open(source.path().join("places.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT)")
        .unwrap();
    drop(db);
    let report = migrate_profile(
        MigrateProfileOptions::new(
            MigrationSource::new("firefox").user_data_dir(source.path()),
            &target,
        )
        .include(["history"]),
    )
    .unwrap();
    assert_eq!(report.migrated.history, 0);
    assert_eq!(report.skipped[0].reason, "source-format-unsupported");
    assert!(report.skipped[0]
        .detail
        .as_ref()
        .unwrap()
        .contains("moz_historyvisits"));
    assert!(!target.exists());
}

#[test]
fn reports_invalid_visit_urls_without_aborting_import() {
    for value in ["NULL", "''", "x'0102'"] {
        let source = TempDir::new("bc-ff-history-");
        let target_root = TempDir::new("bc-ff-history-");
        let filename = source.path().join("places.sqlite");
        let db = Connection::open(&filename).unwrap();
        db.execute_batch(include_str!(
            "../../../../../tests/fixtures/firefox-history.sql"
        ))
        .unwrap();
        db.execute_batch(&format!("INSERT INTO moz_places VALUES (5,{value},'Invalid'); INSERT INTO moz_historyvisits VALUES (5,5,1700000000000005,1)")).unwrap();
        drop(db);
        let before = std::fs::read(&filename).unwrap();
        let report = migrate_profile(
            MigrateProfileOptions::new(
                MigrationSource::new("firefox").user_data_dir(source.path()),
                target_root.path().join("new-profile"),
            )
            .include(["history"])
            .domains(["github.com"]),
        )
        .unwrap();
        assert_eq!(report.migrated.history, 3);
        assert_eq!(report.skipped.len(), 1);
        assert_eq!(report.skipped[0].reason, "invalid-history-url");
        assert_eq!(report.skipped[0].item, "places.sqlite visit 5");
        assert_eq!(std::fs::read(filename).unwrap(), before);
    }
}
