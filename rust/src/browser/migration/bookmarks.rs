//! Bookmarks migration, mirroring `js/src/browser/migration/bookmarks.js`.
//!
//! Chrome stores bookmarks as a single JSON file, `Bookmarks`, in the profile
//! directory. The file is self-contained, so a migration copies it as is.
//! Chrome recomputes the tamper-detection `checksum` on the next launch, so the
//! copy is accepted even though its checksum was written for the source.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::Value;

use super::fs_utils::path_exists;
use super::{ClassOutcome, MigrationEntry};

/// Count the bookmark entries (`type: "url"`) in a Bookmarks JSON tree.
pub(crate) fn count_bookmarks(bookmarks: &Value) -> u64 {
    fn visit(node: &Value) -> u64 {
        if !node.is_object() {
            return 0;
        }
        let own = u64::from(node.get("type").and_then(Value::as_str) == Some("url"));
        let children = node
            .get("children")
            .and_then(Value::as_array)
            .map_or(0, |children| children.iter().map(visit).sum());
        own + children
    }
    bookmarks
        .get("roots")
        .and_then(Value::as_object)
        .map_or(0, |roots| roots.values().map(visit).sum())
}

/// Copy the Bookmarks JSON from a source profile into the target profile.
pub(crate) fn migrate_bookmarks(
    source_profile_dir: &Path,
    target_profile_dir: &Path,
) -> Result<ClassOutcome> {
    let source = source_profile_dir.join("Bookmarks");
    if !path_exists(&source) {
        return Ok(ClassOutcome::skipped(MigrationEntry::new(
            "bookmarks",
            "Bookmarks",
            "source-has-no-bookmarks",
        )));
    }
    // A count is best-effort; the copy is what matters.
    let count = fs::read_to_string(&source)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .map_or(0, |bookmarks| count_bookmarks(&bookmarks));
    fs::create_dir_all(target_profile_dir)
        .with_context(|| format!("Could not create {}", target_profile_dir.display()))?;
    fs::copy(&source, target_profile_dir.join("Bookmarks"))
        .with_context(|| format!("Could not copy {}", source.display()))?;
    Ok(ClassOutcome::migrated(count))
}
