//! Read a Chromium SQLite database (History, Top Sites, Login Data, Web Data)
//! while the source browser is running, without ever writing to the source.
//! Mirrors `js/src/browser/migration/sqlite-snapshot.js`.
//!
//! Chrome keeps these databases open in WAL mode and, on Windows, holds a share
//! lock that stops another process from opening the file at all. Two techniques
//! cover both cases:
//!
//! 1. The SQLite Online Backup API (`rusqlite`'s `backup` feature), which copies
//!    a transactionally consistent snapshot even while the source is being
//!    written (<https://www.sqlite.org/backup.html>). The source is opened
//!    read-only, so nothing is written back.
//! 2. When the source cannot be opened at all (a Windows exclusive lock), the
//!    file and its `-wal`/`-shm`/`-journal` sidecars are copied to a temporary
//!    directory and the copy is read instead. Copying the sidecars keeps the
//!    committed-but-not-checkpointed pages, so the copy is consistent.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use rusqlite::{Connection, OpenFlags};

use super::fs_utils::{make_temp_dir, path_exists, remove_dir_quietly};

const SNAPSHOT_PREFIX: &str = "browser-commander-snap-";
const SQLITE_SIDECARS: [&str; 3] = ["-wal", "-shm", "-journal"];

fn file_name(source_path: &Path) -> Result<&std::ffi::OsStr> {
    source_path
        .file_name()
        .ok_or_else(|| anyhow!("{} has no file name", source_path.display()))
}

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

/// Copy a SQLite file and its sidecars into `dir`.
fn copy_database_files(source_path: &Path, dir: &Path) -> Result<PathBuf> {
    let snapshot_path = dir.join(file_name(source_path)?);
    fs::copy(source_path, &snapshot_path)
        .with_context(|| format!("Could not copy {}", source_path.display()))?;
    for suffix in SQLITE_SIDECARS {
        let sidecar = with_suffix(source_path, suffix);
        if path_exists(&sidecar) {
            fs::copy(&sidecar, with_suffix(&snapshot_path, suffix))
                .with_context(|| format!("Could not copy {}", sidecar.display()))?;
        }
    }
    Ok(snapshot_path)
}

fn open_read_only(path: &Path) -> rusqlite::Result<Connection> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    // A live browser can hold this lock for its entire lifetime. Let the
    // existing file-and-sidecar fallback handle it instead of waiting five
    // seconds for every database in the profile.
    connection.busy_timeout(std::time::Duration::ZERO)?;
    Ok(connection)
}

/// Write a consistent snapshot of `source_path` to `snapshot_path`, falling
/// back to a plain file copy when the source cannot be opened or backed up.
fn snapshot_into(source_path: &Path, dir: &Path) -> Result<PathBuf> {
    tracing::debug!(source = %source_path.display(), "Backing up live SQLite database");
    let snapshot_path = dir.join(file_name(source_path)?);
    let backed_up = open_read_only(source_path).and_then(|source| {
        // `backup` opens the destination itself; the source stays read-only.
        source.backup(rusqlite::MAIN_DB, &snapshot_path, None)
    });
    match backed_up {
        Ok(()) => Ok(snapshot_path),
        Err(_) => {
            // The source is locked exclusively (Windows); copy the file and its
            // sidecars, then read that copy.
            let _ = fs::remove_file(&snapshot_path);
            copy_database_files(source_path, dir)
        }
    }
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
