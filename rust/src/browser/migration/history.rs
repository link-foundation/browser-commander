//! History and Top Sites migration, mirroring
//! `js/src/browser/migration/history.js`.
//!
//! Chrome keeps browsing history in the `History` SQLite database and the
//! new-tab-page most-visited list in `Top Sites`. Both are open and
//! write-locked while Chrome runs, so a migration takes a consistent snapshot
//! through the SQLite Online Backup API (see `sqlite_snapshot`) and writes the
//! snapshot into the target profile. The source is never modified.
//!
//! The snapshot is copied verbatim rather than rebuilt row by row: `History`
//! carries interdependent tables (`urls`, `visits`, `visit_source`,
//! `segments`, ...) whose foreign keys must stay consistent.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};

use super::fs_utils::path_exists;
use super::sqlite_snapshot::with_database_snapshot;
use super::{ClassOutcome, MigrationEntry};

fn count_urls(path: &Path) -> Option<u64> {
    let database = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    database
        .query_row("SELECT COUNT(*) FROM urls", [], |row| row.get::<_, i64>(0))
        .ok()
        .map(|count| u64::try_from(count).unwrap_or_default())
}

/// Snapshot `source_path` into `target_path` and return the best-effort URL
/// count of the copy.
fn snapshot_into(source_path: &Path, target_path: &Path) -> Result<Option<u64>> {
    with_database_snapshot(source_path, |snapshot_path| {
        fs::copy(snapshot_path, target_path)
            .with_context(|| format!("Could not write {}", target_path.display()))?;
        Ok(count_urls(target_path))
    })
}

/// Migrate History (and Top Sites) into the target profile.
pub(crate) fn migrate_history(
    source_profile_dir: &Path,
    target_profile_dir: &Path,
) -> Result<ClassOutcome> {
    let mut outcome = ClassOutcome::default();
    fs::create_dir_all(target_profile_dir)
        .with_context(|| format!("Could not create {}", target_profile_dir.display()))?;

    let history_source = source_profile_dir.join("History");
    let mut url_count = 0;
    let mut migrated_databases = 0;
    if path_exists(&history_source) {
        url_count =
            snapshot_into(&history_source, &target_profile_dir.join("History"))?.unwrap_or(0);
        migrated_databases += 1;
    } else {
        outcome
            .skipped
            .push(MigrationEntry::new("history", "History", "source-missing"));
    }

    let top_sites_source = source_profile_dir.join("Top Sites");
    if path_exists(&top_sites_source) {
        snapshot_into(&top_sites_source, &target_profile_dir.join("Top Sites"))?;
        migrated_databases += 1;
    }

    // The report counts the snapshot as one migrated unit (matching the docs
    // example `"history": 1`), and carries the URL count as a warning detail.
    if url_count > 0 {
        outcome.warnings.push(
            MigrationEntry::new("history", "History", "snapshot-copied").with_detail(format!(
                "{url_count} history URLs copied via the SQLite backup API"
            )),
        );
    }
    outcome.migrated = u64::from(migrated_databases > 0);
    Ok(outcome)
}
