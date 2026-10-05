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

use super::domains::matches_domains;
use super::fs_utils::path_exists;
use super::sqlite_snapshot::with_database_snapshot;
use super::{ClassOutcome, MigrationEntry};

fn filter_history(
    path: &Path,
    domains: &[String],
    warnings: &mut Vec<MigrationEntry>,
) -> Result<()> {
    if domains.is_empty() {
        return Ok(());
    }
    let database = Connection::open(path)?;
    let tables: std::collections::HashSet<String> = database
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    if tables.contains("urls") {
        let rows = database
            .prepare("SELECT id,url FROM urls")?
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (id, url) in rows {
            if !matches_domains(&url, domains) {
                database.execute("DELETE FROM urls WHERE id=?", [id])?;
            }
        }
        for (table, column) in [
            ("visits", "url"),
            ("segments", "url_id"),
            ("keyword_search_terms", "url_id"),
        ] {
            if tables.contains(table) {
                database.execute(
                    &format!("DELETE FROM {table} WHERE {column} NOT IN (SELECT id FROM urls)"),
                    [],
                )?;
            }
        }
        if tables.contains("visits") {
            for (table, column) in [
                ("visit_source", "id"),
                ("content_annotations", "visit_id"),
                ("context_annotations", "visit_id"),
            ] {
                if tables.contains(table) {
                    database.execute(
                        &format!(
                            "DELETE FROM {table} WHERE {column} NOT IN (SELECT id FROM visits)"
                        ),
                        [],
                    )?;
                }
            }
        }
        if tables.contains("segments") && tables.contains("segment_usage") {
            database.execute(
                "DELETE FROM segment_usage WHERE segment_id NOT IN (SELECT id FROM segments)",
                [],
            )?;
        }
    }
    filter_downloads(&database, &tables, domains)?;
    if tables.contains("top_sites") {
        let rows = database
            .prepare("SELECT url FROM top_sites")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for url in rows {
            if !matches_domains(&url, domains) {
                database.execute("DELETE FROM top_sites WHERE url=?", [&url])?;
            }
        }
    }
    omit_unfiltered_metadata(&database, &tables, warnings)?;
    database.execute_batch("VACUUM")?;
    Ok(())
}

fn omit_unfiltered_metadata(
    database: &Connection,
    tables: &std::collections::HashSet<String>,
    warnings: &mut Vec<MigrationEntry>,
) -> Result<()> {
    let mut filtered: std::collections::HashSet<&str> =
        ["urls", "downloads", "top_sites", "meta", "sqlite_sequence"]
            .into_iter()
            .collect();
    if tables.contains("urls") {
        filtered.extend(["visits", "segments", "keyword_search_terms"]);
        if tables.contains("visits") {
            filtered.extend(["visit_source", "content_annotations", "context_annotations"]);
        }
        if tables.contains("segments") {
            filtered.insert("segment_usage");
        }
    }
    if tables.contains("downloads") {
        filtered.extend(["downloads_url_chains", "downloads_slices"]);
    }
    // A mixed-domain cluster can describe excluded visits. Unknown metadata
    // schemas have no safe association with the selected domains either.
    let mut names: Vec<_> = tables.iter().collect();
    names.sort();
    for table in names {
        if filtered.contains(table.as_str()) {
            continue;
        }
        let identifier = format!("\"{}\"", table.replace('"', "\"\""));
        let count: i64 =
            database.query_row(&format!("SELECT COUNT(*) FROM {identifier}"), [], |row| {
                row.get(0)
            })?;
        database.execute(&format!("DELETE FROM {identifier}"), [])?;
        if count > 0 {
            warnings.push(
                MigrationEntry::new("history", table, "unsupported-history-metadata")
                    .with_detail(format!("{count} copied metadata rows removed")),
            );
        }
    }
    Ok(())
}

fn filter_downloads(
    database: &Connection,
    tables: &std::collections::HashSet<String>,
    domains: &[String],
) -> Result<()> {
    if !tables.contains("downloads") {
        return Ok(());
    }
    let columns: Vec<String> = database
        .prepare("PRAGMA table_info(downloads)")?
        .query_map([], |row| row.get(1))?
        .collect::<rusqlite::Result<_>>()?;
    let ids: Vec<i64> = database
        .prepare("SELECT id FROM downloads")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in ids {
        let mut urls = Vec::new();
        for column in ["url", "site_url", "tab_url", "referrer", "tab_referrer_url"] {
            if columns.iter().any(|name| name == column) {
                let url: Option<String> = database.query_row(
                    &format!("SELECT {column} FROM downloads WHERE id=?"),
                    [id],
                    |row| row.get(0),
                )?;
                if let Some(url) = url.filter(|value| !value.is_empty()) {
                    urls.push(url);
                }
            }
        }
        if tables.contains("downloads_url_chains") {
            urls.extend(
                database
                    .prepare("SELECT url FROM downloads_url_chains WHERE id=?")?
                    .query_map([id], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?,
            );
        }
        if urls.is_empty() || urls.iter().any(|url| !matches_domains(url, domains)) {
            database.execute("DELETE FROM downloads WHERE id=?", [id])?;
        }
    }
    for (table, column) in [
        ("downloads_url_chains", "id"),
        ("downloads_slices", "download_id"),
    ] {
        if tables.contains(table) {
            database.execute(
                &format!("DELETE FROM {table} WHERE {column} NOT IN (SELECT id FROM downloads)"),
                [],
            )?;
        }
    }
    Ok(())
}

fn count_urls(path: &Path) -> Option<u64> {
    let database = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    database
        .query_row("SELECT COUNT(*) FROM urls", [], |row| row.get::<_, i64>(0))
        .ok()
        .map(|count| u64::try_from(count).unwrap_or_default())
}

/// Snapshot `source_path` into `target_path` and return the best-effort URL
/// count of the copy.
fn snapshot_into(
    source_path: &Path,
    target_path: &Path,
    domains: &[String],
    warnings: &mut Vec<MigrationEntry>,
) -> Result<Option<u64>> {
    with_database_snapshot(source_path, |snapshot_path| {
        fs::copy(snapshot_path, target_path)
            .with_context(|| format!("Could not write {}", target_path.display()))?;
        filter_history(target_path, domains, warnings)?;
        Ok(count_urls(target_path))
    })
}

/// Migrate History (and Top Sites) into the target profile.
#[cfg(test)]
pub(crate) fn migrate_history(
    source_profile_dir: &Path,
    target_profile_dir: &Path,
) -> Result<ClassOutcome> {
    migrate_history_filtered(source_profile_dir, target_profile_dir, &[])
}

pub(crate) fn migrate_history_filtered(
    source_profile_dir: &Path,
    target_profile_dir: &Path,
    domains: &[String],
) -> Result<ClassOutcome> {
    let mut outcome = ClassOutcome::default();
    fs::create_dir_all(target_profile_dir)
        .with_context(|| format!("Could not create {}", target_profile_dir.display()))?;

    let history_source = source_profile_dir.join("History");
    let mut url_count = 0;
    let mut migrated_databases = 0;
    if path_exists(&history_source) {
        url_count = snapshot_into(
            &history_source,
            &target_profile_dir.join("History"),
            domains,
            &mut outcome.warnings,
        )?
        .unwrap_or(0);
        migrated_databases += 1;
    } else {
        outcome
            .skipped
            .push(MigrationEntry::new("history", "History", "source-missing"));
    }

    let top_sites_source = source_profile_dir.join("Top Sites");
    if path_exists(&top_sites_source) {
        snapshot_into(
            &top_sites_source,
            &target_profile_dir.join("Top Sites"),
            domains,
            &mut outcome.warnings,
        )?;
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
