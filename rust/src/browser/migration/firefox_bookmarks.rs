//! Convert a Firefox `places.sqlite` bookmark tree into Chrome's `Bookmarks`
//! JSON format, mirroring `js/src/browser/migration/firefox-bookmarks.js`.
//!
//! Firefox keeps bookmarks in `moz_bookmarks` (a tree of rows, type 1 =
//! bookmark, type 2 = folder) joined to `moz_places` for the URLs. Chrome keeps
//! them in a JSON document with three roots (`bookmark_bar`, `other`,
//! `synced`). The Firefox toolbar maps to Chrome's bookmarks bar; the Firefox
//! menu and unsorted bookmarks map to Chrome's "other bookmarks".

use std::collections::HashMap;

use serde_json::{json, Value};

/// Chrome stores timestamps as microseconds since 1601-01-01; a fixed, valid
/// value is fine for imported bookmarks (Chrome only needs it to be parseable).
const CHROME_TIMESTAMP: &str = "13300000000000000";

/// Firefox root names (stable across profiles).
const FIREFOX_ROOTS: [&str; 3] = ["toolbar", "menu", "unfiled"];

/// One `moz_bookmarks` row joined with its `moz_places` URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FirefoxBookmarkRow {
    pub id: i64,
    pub parent: i64,
    pub row_type: i64,
    pub title: Option<String>,
    pub url: Option<String>,
    /// `toolbar`, `menu` or `unfiled` for the Firefox root folders.
    pub root: Option<String>,
}

enum Node {
    Url {
        title: Option<String>,
        url: Option<String>,
    },
    Folder {
        title: Option<String>,
        children: Vec<Node>,
    },
}

fn next_id(counter: &mut u64) -> String {
    *counter += 1;
    counter.to_string()
}

fn build_chrome_node(node: &Node, counter: &mut u64) -> Value {
    match node {
        Node::Url { title, url } => json!({
            "date_added": CHROME_TIMESTAMP,
            "id": next_id(counter),
            "name": title.clone().or_else(|| url.clone()).unwrap_or_default(),
            "type": "url",
            "url": url,
        }),
        Node::Folder { title, children } => {
            let id = next_id(counter);
            let children: Vec<Value> = children
                .iter()
                .map(|child| build_chrome_node(child, counter))
                .collect();
            json!({
                "children": children,
                "date_added": CHROME_TIMESTAMP,
                "date_modified": CHROME_TIMESTAMP,
                "id": id,
                "name": title.clone().unwrap_or_default(),
                "type": "folder",
            })
        }
    }
}

fn collect_children(by_parent: &HashMap<i64, Vec<&FirefoxBookmarkRow>>, parent: i64) -> Vec<Node> {
    by_parent
        .get(&parent)
        .map(|rows| {
            rows.iter()
                .map(|row| {
                    if row.row_type == 2 {
                        Node::Folder {
                            title: row.title.clone(),
                            children: collect_children(by_parent, row.id),
                        }
                    } else {
                        Node::Url {
                            title: row.title.clone(),
                            url: row.url.clone(),
                        }
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn count_urls(node: &Value) -> u64 {
    if node.get("type").and_then(Value::as_str) == Some("url") {
        return 1;
    }
    node.get("children")
        .and_then(Value::as_array)
        .map(|children| children.iter().map(count_urls).sum())
        .unwrap_or(0)
}

/// Convert flat `moz_bookmarks` rows (joined with URLs) to a Chrome
/// `Bookmarks` document, returning the document and the number of URLs.
pub(crate) fn firefox_bookmarks_to_chrome(rows: &[FirefoxBookmarkRow]) -> (Value, u64) {
    let mut by_parent: HashMap<i64, Vec<&FirefoxBookmarkRow>> = HashMap::new();
    for row in rows {
        by_parent.entry(row.parent).or_default().push(row);
    }
    let mut root_ids: HashMap<&str, i64> = HashMap::new();
    for row in rows {
        if let Some(root) = row.root.as_deref() {
            if let Some(name) = FIREFOX_ROOTS.iter().find(|name| **name == root) {
                root_ids.insert(name, row.id);
            }
        }
    }

    let mut counter = 0_u64;
    let mut make_root = |name: &str, firefox_roots: &[&str]| {
        let mut children = Vec::new();
        for key in firefox_roots {
            if let Some(root_id) = root_ids.get(key) {
                for child in collect_children(&by_parent, *root_id) {
                    children.push(build_chrome_node(&child, &mut counter));
                }
            }
        }
        json!({
            "children": children,
            "date_added": CHROME_TIMESTAMP,
            "date_modified": CHROME_TIMESTAMP,
            "id": next_id(&mut counter),
            "name": name,
            "type": "folder",
        })
    };

    let bookmark_bar = make_root("Bookmarks bar", &["toolbar"]);
    let other = make_root("Other bookmarks", &["menu", "unfiled"]);
    let synced = make_root("Mobile bookmarks", &["__none__"]);
    let count = count_urls(&bookmark_bar) + count_urls(&other) + count_urls(&synced);

    let document = json!({
        "checksum": "",
        "roots": {
            "bookmark_bar": bookmark_bar,
            "other": other,
            "synced": synced,
        },
        "version": 1,
    });
    (document, count)
}
