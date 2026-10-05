//! Firefox history translated through the shared native Chromium writer.

use std::{collections::HashSet, path::Path};

use anyhow::Result;
use rusqlite::Connection;

use super::{
    chromium_writers::write_chromium_history, domains::matches_domains,
    fs_utils::profile_file_if_present, safari::HistoryVisit,
    sqlite_snapshot::read_database_snapshot, ClassOutcome, MigrationEntry,
};

struct VisitRow {
    url: Option<String>,
    title: String,
    id: i64,
    time: Option<i64>,
}

fn read_rows(db: &Connection) -> Result<Option<Vec<VisitRow>>> {
    for (table, required) in [
        ("moz_places", ["id", "url", "title"]),
        ("moz_historyvisits", ["id", "place_id", "visit_date"]),
    ] {
        let mut query = db.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns: HashSet<String> = query
            .query_map([], |row| row.get(1))?
            .collect::<rusqlite::Result<_>>()?;
        if !required.iter().all(|name| columns.contains(*name)) {
            return Ok(None);
        }
    }
    let mut query = db.prepare("SELECT p.url,p.title,v.id,v.visit_date FROM moz_historyvisits v JOIN moz_places p ON v.place_id=p.id ORDER BY v.visit_date,v.id")?;
    let rows = query
        .query_map([], |row| {
            Ok(VisitRow {
                url: row.get_ref(0)?.as_str().ok().map(str::to_string),
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                id: row.get(2)?,
                time: row.get_ref(3)?.as_i64().ok(),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(Some(rows))
}

pub(crate) fn migrate_firefox_history(
    profile: &Path,
    target: &Path,
    domains: &[String],
) -> Result<ClassOutcome> {
    let Some(filename) = profile_file_if_present(profile, "places.sqlite") else {
        return Ok(ClassOutcome::skipped(MigrationEntry::new(
            "history",
            "places.sqlite",
            "source-missing",
        )));
    };
    let Some(rows) = read_database_snapshot(&filename, read_rows)? else {
        return Ok(ClassOutcome::skipped(MigrationEntry::new("history", "places.sqlite", "source-format-unsupported")
            .with_detail("Firefox history requires moz_places and moz_historyvisits with URL, title and integer visit dates; no target was written.")));
    };
    let mut outcome = ClassOutcome::default();
    let mut visits = Vec::new();
    for row in rows {
        let Some(url) = row.url.filter(|url| !url.is_empty()) else {
            outcome.skipped.push(
                MigrationEntry::new(
                    "history",
                    format!("places.sqlite visit {}", row.id),
                    "invalid-history-url",
                )
                .with_detail("The visit URL is not a nonempty string."),
            );
            continue;
        };
        if !matches_domains(&url, domains) {
            continue;
        }
        let time = row
            .time
            .filter(|time| (-11644473600000000..=9211727563254775807).contains(time));
        let Some(time) = time else {
            outcome.skipped.push(
                MigrationEntry::new(
                    "history",
                    format!("places.sqlite visit {}", row.id),
                    "invalid-history-timestamp",
                )
                .with_detail(
                    "The visit date is not an integer representable in the target history format.",
                ),
            );
            continue;
        };
        visits.push(HistoryVisit {
            url,
            title: row.title,
            time,
        });
    }
    if !visits.is_empty() {
        outcome.migrated = write_chromium_history(target, &visits)?;
        outcome.warnings.push(MigrationEntry::new("history", "places.sqlite", "firefox-history-metadata-not-translated")
            .with_detail("URL/title and visit dates were translated; Firefox transition types, referring visits and sync metadata were not copied."));
    }
    Ok(outcome)
}
