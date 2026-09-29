//! Mirrors `js/tests/unit/browser/migration/history.test.js`.

use super::super::history::migrate_history;
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
    assert!(warning.detail.as_deref().unwrap().contains("5 history URLs"));
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
