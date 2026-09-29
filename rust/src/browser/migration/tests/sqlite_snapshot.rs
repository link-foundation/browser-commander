//! Mirrors `js/tests/unit/browser/migration/sqlite-snapshot.test.js`.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};

use super::super::sqlite_snapshot::{read_database_snapshot, with_database_snapshot};
use super::fixtures::{assert_source_unchanged, write_chromium_history, TempDir};

fn count_urls(database: &Connection) -> rusqlite::Result<i64> {
    database.query_row("SELECT COUNT(*) FROM urls", [], |row| row.get(0))
}

#[test]
fn produces_a_consistent_snapshot_readable_by_the_reader() {
    let dir = TempDir::new("bc-snap-");
    let database_path = write_chromium_history(dir.path(), 3);
    let count = with_database_snapshot(&database_path, |snapshot_path| {
        let database =
            Connection::open_with_flags(snapshot_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        Ok(count_urls(&database)?)
    })
    .unwrap();
    assert_eq!(count, 3);
}

#[test]
fn deletes_the_snapshot_after_the_reader_completes() {
    let dir = TempDir::new("bc-snap-");
    let database_path = write_chromium_history(dir.path(), 1);
    let captured: PathBuf = with_database_snapshot(&database_path, |snapshot_path| {
        Ok(snapshot_path.to_path_buf())
    })
    .unwrap();
    assert!(!captured.exists());
}

#[test]
fn rejects_when_the_source_does_not_exist() {
    let error = with_database_snapshot(Path::new("/no/such/History"), |_| Ok(())).unwrap_err();
    assert!(error.to_string().contains("does not exist"));
}

#[test]
fn opens_the_snapshot_read_only_and_does_not_modify_the_source() {
    let dir = TempDir::new("bc-snap-");
    let database_path = write_chromium_history(dir.path(), 2);
    let count = assert_source_unchanged(&database_path, || {
        read_database_snapshot(&database_path, |database| Ok(count_urls(database)?)).unwrap()
    });
    assert_eq!(count, 2);
}
