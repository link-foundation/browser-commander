//! Read a Chromium SQLite database (History, Top Sites, Login Data, Web Data)
//! while the source browser is running, without ever writing to the source.
//! Mirrors `js/src/browser/migration/sqlite-snapshot.js`.
//!
//! SQLite online backup includes committed WAL data without writing to the
//! source (<https://www.sqlite.org/backup.html>). Exclusive/sharing locks return
//! snapshot guidance. A sequential copy of live files cannot ensure consistency.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{Connection, OpenFlags};

use super::fs_utils::{make_temp_dir, path_exists, remove_dir_quietly};

const SNAPSHOT_PREFIX: &str = "browser-commander-snap-";

fn file_name(source_path: &Path) -> Result<&std::ffi::OsStr> {
    source_path
        .file_name()
        .ok_or_else(|| anyhow!("{} has no file name", source_path.display()))
}

fn open_read_only(path: &Path) -> rusqlite::Result<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    // A live browser can hold this lock for its entire lifetime; return
    // actionable guidance immediately instead of waiting for each database.
    connection.busy_timeout(std::time::Duration::ZERO)?;
    Ok(connection)
}

/// Write a consistent snapshot or return guidance without copying live files.
fn snapshot_into(source_path: &Path, dir: &Path) -> Result<PathBuf> {
    tracing::debug!(source = %source_path.display(), "Backing up live SQLite database");
    let snapshot_path = dir.join(file_name(source_path)?);
    let backed_up = open_read_only(source_path).and_then(|source| {
        // `backup` opens the destination itself; the source stays read-only.
        source.backup(rusqlite::MAIN_DB, &snapshot_path, None)
    });
    backed_up.with_context(|| format!(
        "Consistent SQLite snapshot unavailable for {}; close the source browser and retry, or supply a consistent read-only snapshot.",
        source_path.display()
    ))?;
    Ok(snapshot_path)
}

/// Produce a consistent, read-only snapshot copy of a live Chromium database in
/// a temporary directory, then hand its path to `read`. The snapshot is always
/// deleted afterwards, and the source is never modified.
pub(crate) fn with_database_snapshot<T>(
    source_path: &Path,
    read: impl FnOnce(&Path) -> Result<T>,
) -> Result<T> {
    if !path_exists(source_path) {
        return Err(anyhow!(
            "Source database does not exist: {}",
            source_path.display()
        ));
    }
    let dir = make_temp_dir(SNAPSHOT_PREFIX)?;
    let result = snapshot_into(source_path, &dir).and_then(|path| read(&path));
    remove_dir_quietly(&dir);
    result
}

/// Open a snapshot database read-only, run `read` against it, and close it.
pub(crate) fn read_database_snapshot<T>(
    source_path: &Path,
    read: impl FnOnce(&Connection) -> Result<T>,
) -> Result<T> {
    with_database_snapshot(source_path, |snapshot_path| {
        let database = open_read_only(snapshot_path)
            .with_context(|| format!("Could not open {}", snapshot_path.display()))?;
        read(&database)
    })
}
