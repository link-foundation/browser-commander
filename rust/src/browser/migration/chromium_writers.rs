//! Target-native Chromium formats for translated Safari data.

use std::{collections::HashMap, path::Path};

use anyhow::Result;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::safari::HistoryVisit;

pub(crate) fn write_chromium_bookmarks(target: &Path, entries: &[Value]) -> Result<u64> {
    fn convert(node: &Value, id: &mut u64, count: &mut u64) -> Value {
        *id += 1;
        let mut result = json!({"id": id.to_string(), "date_added": "13300000000000000", "name": node["name"], "type": node["type"]});
        if node["type"] == "url" {
            *count += 1;
            result["url"] = node["url"].clone();
        } else {
            result["date_modified"] = result["date_added"].clone();
            result["children"] = json!(node["children"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|node| convert(node, id, count))
                .collect::<Vec<_>>());
        }
        result
    }
    let mut id = 3;
    let mut count = 0;
    let mut roots = serde_json::Map::new();
    for (index, name) in ["bookmark_bar", "other", "synced"].iter().enumerate() {
        let children = if *name == "other" {
            entries
                .iter()
                .map(|node| convert(node, &mut id, &mut count))
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        roots.insert((*name).into(),json!({"id": (index+1).to_string(), "name": name, "type": "folder", "date_added":"13300000000000000", "date_modified":"13300000000000000", "children":children}));
    }
    std::fs::create_dir_all(target)?;
    std::fs::write(
        target.join("Bookmarks"),
        serde_json::to_vec(&json!({"version":1,"roots":roots}))?,
    )?;
    Ok(count)
}

pub(crate) fn write_chromium_history(target: &Path, entries: &[HistoryVisit]) -> Result<u64> {
    std::fs::create_dir_all(target)?;
    let mut db = Connection::open(target.join("History"))?;
    db.execute_batch(include_str!("chromium-history.sql"))?;
    let tx = db.transaction()?;
    let mut urls = HashMap::new();
    for entry in entries {
        let id = if let Some(id) = urls.get(&entry.url) {
            *id
        } else {
            tx.execute(
                "INSERT INTO urls (url,title,visit_count,last_visit_time) VALUES (?1,?2,0,0)",
                params![entry.url, entry.title],
            )?;
            let id = tx.last_insert_rowid();
            urls.insert(entry.url.clone(), id);
            id
        };
        let time = entry.time + 11644473600000000;
        tx.execute("UPDATE urls SET title=?1,visit_count=visit_count+1,last_visit_time=max(last_visit_time,?2) WHERE id=?3",params![entry.title,time,id])?;
        tx.execute(
            "INSERT INTO visits (url,visit_time) VALUES (?1,?2)",
            params![id, time],
        )?;
    }
    tx.commit()?;
    Ok(entries.len() as u64)
}
