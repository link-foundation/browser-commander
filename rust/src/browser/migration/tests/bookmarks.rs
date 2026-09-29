//! Mirrors `js/tests/unit/browser/migration/bookmarks.test.js`.

use serde_json::{json, Value};

use super::super::bookmarks::{count_bookmarks, migrate_bookmarks};
use super::fixtures::{assert_nothing_migrated, read_profile_json, write_profile_json, TempDir};

fn sample_bookmarks() -> Value {
    json!({
        "checksum": "source-checksum",
        "roots": {
            "bookmark_bar": {
                "type": "folder",
                "children": [
                    { "type": "url", "name": "A", "url": "https://a.example/" },
                    {
                        "type": "folder",
                        "children": [{ "type": "url", "name": "B", "url": "https://b.example/" }],
                    },
                ],
            },
            "other": { "type": "folder", "children": [] },
        },
    })
}

#[test]
fn counts_url_nodes_recursively_across_roots() {
    assert_eq!(count_bookmarks(&sample_bookmarks()), 2);
}

#[test]
fn returns_zero_for_empty_or_invalid_trees() {
    assert_eq!(count_bookmarks(&json!({})), 0);
    assert_eq!(count_bookmarks(&Value::Null), 0);
}

#[test]
fn copies_the_bookmarks_json_verbatim_and_reports_the_count() {
    let source = TempDir::new("bc-bookmarks-");
    let target = TempDir::new("bc-bookmarks-");
    write_profile_json(source.path(), "Bookmarks", &sample_bookmarks());

    let report = migrate_bookmarks(source.path(), target.path()).unwrap();

    assert_eq!(report.migrated, 2);
    assert!(report.skipped.is_empty());
    assert_eq!(
        read_profile_json(target.path(), "Bookmarks"),
        sample_bookmarks()
    );
}

#[test]
fn reports_a_skip_when_the_source_has_no_bookmarks() {
    let source = TempDir::new("bc-bookmarks-");
    let target = TempDir::new("bc-bookmarks-");

    let report = migrate_bookmarks(source.path(), target.path()).unwrap();

    assert_nothing_migrated(&report, "source-has-no-bookmarks");
    assert_eq!(report.skipped.len(), 1);
}
