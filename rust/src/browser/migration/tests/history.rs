//! Mirrors `js/tests/unit/browser/migration/history.test.js`.

use super::super::history::migrate_history;
use super::super::sqlite_snapshot::with_database_snapshot;
use super::fixtures::{
    assert_nothing_migrated, assert_source_unchanged, write_chromium_history, TempDir,
};

#[test]
fn snapshots_history_into_the_target_and_reports_the_url_count() {
    let source = TempDir::new("bc-history-");
    let target = TempDir::new("bc-history-");
    write_chromium_history(source.path(), 5);

    let report = migrate_history(source.path(), target.path()).unwrap();

    assert_eq!(report.migrated, 1);
    assert!(target.path().join("History").is_file());
    let warning = report
        .warnings
        .iter()
        .find(|warning| warning.reason == "snapshot-copied")
        .expect("snapshot warning");
    assert!(warning
        .detail
        .as_deref()
        .unwrap()
        .contains("5 history URLs"));
}

#[test]
fn never_writes_to_the_source_database() {
    let source = TempDir::new("bc-history-");
    let target = TempDir::new("bc-history-");
    let history_path = write_chromium_history(source.path(), 2);

    assert_source_unchanged(&history_path, || {
        migrate_history(source.path(), target.path()).unwrap()
    });
}

#[test]
fn reports_a_skip_when_there_is_no_history_database() {
    let source = TempDir::new("bc-history-");
    let target = TempDir::new("bc-history-");
    let report = migrate_history(source.path(), target.path()).unwrap();
    assert_nothing_migrated(&report, "source-missing");
}

#[test]
fn rejects_unverified_file_copy_when_backup_fails() {
    let source = TempDir::new("bc-invalid-history-");
    let history = source.path().join("History");
    std::fs::write(&history, "not a SQLite database").unwrap();
    let mut reader_called = false;
    let result = with_database_snapshot(&history, |_| {
        reader_called = true;
        Ok(())
    });
    let error = result.unwrap_err().to_string();
    assert!(error.contains("Consistent SQLite snapshot unavailable"));
    assert!(error.contains("close the source browser"));
    assert!(!reader_called);
}

#[test]
fn reports_guidance_when_exclusive_lock_prevents_backup() {
    let source = TempDir::new("bc-locked-history-");
    let history = write_chromium_history(source.path(), 1);
    let writer = rusqlite::Connection::open(&history).unwrap();
    writer.execute_batch("BEGIN EXCLUSIVE").unwrap();
    let error =
        with_database_snapshot::<()>(&history, |_| panic!("locked snapshot reader invoked"))
            .unwrap_err()
            .to_string();
    assert!(error.contains("Consistent SQLite snapshot unavailable"));
    assert!(error.contains("close the source browser"));
    writer.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn includes_committed_wal_records_with_open_source_connection() {
    let source = TempDir::new("bc-wal-history-");
    let history = write_chromium_history(source.path(), 1);
    let writer = rusqlite::Connection::open(&history).unwrap();
    writer
        .execute_batch("PRAGMA journal_mode=WAL; UPDATE urls SET title='committed WAL title'")
        .unwrap();
    let title = super::super::sqlite_snapshot::read_database_snapshot(&history, |database| {
        Ok(database.query_row("SELECT title FROM urls", [], |row| row.get::<_, String>(0))?)
    })
    .unwrap();
    assert_eq!(title, "committed WAL title");
}

#[test]
fn filters_unrelated_urls_and_visits_without_writing_to_the_source() {
    let source = TempDir::new("bc-domain-history-");
    let target = TempDir::new("bc-domain-history-");
    let database = rusqlite::Connection::open(source.path().join("History")).unwrap();
    database
        .execute_batch(include_str!(
            "../../../../../tests/fixtures/history-domain-isolation.sql"
        ))
        .unwrap();
    drop(database);
    assert_source_unchanged(&source.path().join("History"), || {
        super::super::history::migrate_history_filtered(
            source.path(),
            target.path(),
            &["github.com".into()],
        )
        .unwrap()
    });
    let database = rusqlite::Connection::open(target.path().join("History")).unwrap();
    for table in [
        "urls",
        "visits",
        "content_annotations",
        "context_annotations",
        "segment_usage",
        "downloads",
        "downloads_url_chains",
        "downloads_slices",
    ] {
        assert_eq!(
            database
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
}
