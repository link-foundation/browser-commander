//! Native Safari readers. Passwords come only from an explicit CSV export.

use std::path::Path;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::{domains::matches_domains, sqlite_snapshot::read_database_snapshot};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct HistoryVisit {
    pub url: String,
    pub title: String,
    pub time: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct PasswordEntry {
    pub origin: String,
    pub username: String,
    pub password: String,
}

pub(crate) fn with_safari_access<T>(
    filename: &Path,
    read: impl FnOnce() -> Result<T>,
) -> Result<T> {
    read().map_err(|error| {
        if error.downcast_ref::<std::io::Error>().is_some_and(|cause| {
            cause.kind() == std::io::ErrorKind::PermissionDenied
        }) {
            let app = std::env::var("__CFBundleIdentifier")
                .or_else(|_| std::env::var("TERM_PROGRAM"))
                .unwrap_or_else(|_| "the terminal running Browser Commander".into());
            error.context(format!(
                "Safari access denied at {}. Grant Full Disk Access to {}, the app running Browser Commander, then retry: x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles",
                filename.display(), app
            ))
        } else {
            error
        }
    })
}

pub(crate) fn read_safari_bookmarks(filename: &Path) -> Result<Vec<Value>> {
    let document: Value = with_safari_access(filename, || {
        let bytes = std::fs::read(filename)?;
        let plist = plist::Value::from_reader(std::io::Cursor::new(bytes))?;
        Ok(serde_json::to_value(plist)?)
    })?;
    fn convert(node: &Value, reading_list: bool) -> Option<Value> {
        let reading_list = reading_list
            || node["Title"] == "com.apple.ReadingList"
            || node.get("ReadingList").is_some();
        if node["WebBookmarkType"] == "WebBookmarkTypeLeaf" {
            let url = node["URLString"].as_str()?;
            return Some(json!({
                "type": "url", "url": url, "readingList": reading_list,
                "name": node["URIDictionary"]["title"].as_str()
                    .or_else(|| node["Title"].as_str()).unwrap_or(url)
            }));
        }
        Some(json!({
            "type": "folder",
            "name": if reading_list { "Reading List" } else { node["Title"].as_str().unwrap_or("") },
            "children": node["Children"].as_array().into_iter().flatten()
                .filter_map(|child| convert(child, reading_list)).collect::<Vec<_>>()
        }))
    }
    Ok(document["Children"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|node| convert(node, false))
        .collect())
}

pub(crate) fn read_safari_history(
    filename: &Path,
    domains: &[String],
) -> Result<Vec<HistoryVisit>> {
    with_safari_access(filename, || {
        let _ = std::fs::File::open(filename)?;
        read_database_snapshot(filename, |db| {
            let mut query = db.prepare("SELECT i.url,v.title,v.visit_time FROM history_items i JOIN history_visits v ON i.id=v.history_item ORDER BY v.visit_time,v.id")?;
            let rows = query.query_map([], |row| {
                Ok(HistoryVisit {
                    url: row.get(0)?,
                    title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    time: ((row.get::<_, f64>(2)? + 978307200.0) * 1000000.0).round() as i64,
                })
            })?;
            let mut entries = Vec::new();
            for entry in rows {
                let entry = entry?;
                if matches_domains(&entry.url, domains) {
                    entries.push(entry);
                }
            }
            Ok(entries)
        })
    })
}

pub(crate) fn read_safari_passwords(
    filename: &Path,
    domains: &[String],
) -> Result<Vec<PasswordEntry>> {
    let mut reader = csv::Reader::from_path(filename)?;
    let headers = reader.headers()?.clone();
    let index = |name| {
        headers
            .iter()
            .position(|header| header == name)
            .ok_or_else(|| {
                anyhow!("Safari password CSV must have URL, Username and Password columns")
            })
    };
    let origin = index("URL")?;
    let username = index("Username")?;
    let password = index("Password")?;
    let mut entries = Vec::new();
    for record in reader.records() {
        let record = record?;
        if !record[origin].is_empty() && matches_domains(&record[origin], domains) {
            entries.push(PasswordEntry {
                origin: record[origin].into(),
                username: record[username].into(),
                password: record[password].into(),
            });
        }
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/safari-data")
            .join(name)
    }

    #[test]
    fn binary_and_xml_preserve_tree_reading_list_and_source() {
        for format in ["binary", "xml"] {
            let filename = fixture(&format!("Bookmarks-{format}.plist"));
            let before = std::fs::read(&filename).unwrap();
            let tree = read_safari_bookmarks(&filename).unwrap();
            assert_eq!(tree[0]["children"][0]["name"], "Foundation ☃");
            assert_eq!(tree[1]["children"][0]["readingList"], true);
            assert_eq!(std::fs::read(filename).unwrap(), before);
        }
    }

    #[test]
    fn history_preserves_matching_visits_and_source() {
        let filename = fixture("History.db");
        let before = std::fs::read(&filename).unwrap();
        let entries = read_safari_history(&filename, &["github.com".into()]).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].time, 1778307200250000);
        assert_eq!(std::fs::read(filename).unwrap(), before);
    }

    #[test]
    fn exported_csv_preserves_quoted_utf8_fields_and_filters_domains() {
        let entries =
            read_safari_passwords(&fixture("Passwords.csv"), &["github.com".into()]).unwrap();
        assert_eq!(
            entries,
            vec![PasswordEntry {
                origin: "https://github.com/login".into(),
                username: "a,b".into(),
                password: "p\"a\nss".into(),
            }]
        );
    }

    #[test]
    fn exported_csv_rejects_incomplete_or_extra_fields_without_mutation() {
        let dir = crate::browser::migration::fs_utils::make_temp_dir("bc-safari-csv-").unwrap();
        let filename = dir.join("Passwords.csv");
        for record in ["https://github.com,a\n", "https://github.com,a,b,c\n"] {
            let before = format!("URL,Username,Password\n{record}");
            std::fs::write(&filename, &before).unwrap();
            assert!(read_safari_passwords(&filename, &[]).is_err());
            assert_eq!(std::fs::read_to_string(&filename).unwrap(), before);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
