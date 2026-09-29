//! Preferences migration, mirroring `js/src/browser/migration/preferences.js`.
//!
//! Chrome's `Preferences` file is a large JSON document. Copying it wholesale
//! would drag machine- and session-specific state into the dedicated profile
//! (window placement, the profile's own GAIA identity, per-profile paths), so a
//! migration copies only a documented, portable subset
//! ([`MIGRATED_PREFERENCE_PATHS`]) and merges it into the target's existing
//! `Preferences`.
//!
//! `download.default_directory` is deliberately excluded: a path that exists on
//! the source machine's account may not exist for the dedicated profile.
//!
//! `Secure Preferences` (the file that carries a per-setting HMAC to detect
//! tampering) is not touched; the settings above live in the plain
//! `Preferences` file, which Chrome does not HMAC-protect.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{Map, Value};

use super::fs_utils::path_exists;
use super::{ClassOutcome, MigrationEntry};

/// Dotted paths copied from the source Preferences into the target.
pub const MIGRATED_PREFERENCE_PATHS: [&str; 11] = [
    "intl.accept_languages",
    "intl.selected_languages",
    "spellcheck.dictionaries",
    "default_search_provider_data",
    "browser.theme",
    "extensions.theme",
    "homepage",
    "homepage_is_newtabpage",
    "session.startup_urls",
    "session.restore_on_startup",
    "bookmark_bar.show_on_all_tabs",
];

fn get_path<'a>(object: &'a Value, dotted_path: &str) -> Option<&'a Value> {
    dotted_path
        .split('.')
        .try_fold(object, |node, key| node.as_object()?.get(key))
}

fn set_path(object: &mut Value, dotted_path: &str, value: Value) {
    let keys: Vec<&str> = dotted_path.split('.').collect();
    let (last, parents) = keys.split_last().expect("a dotted path has a key");
    let mut node = object;
    for key in parents {
        let map = ensure_object(node);
        let child = map
            .entry((*key).to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !child.is_object() {
            *child = Value::Object(Map::new());
        }
        node = child;
    }
    ensure_object(node).insert((*last).to_string(), value);
}

fn ensure_object(node: &mut Value) -> &mut Map<String, Value> {
    if !node.is_object() {
        *node = Value::Object(Map::new());
    }
    node.as_object_mut().expect("the node was just made an object")
}

/// Merge the selected subset of source Preferences into `target` (pure, so it
/// is easy to unit-test) and return the paths that were copied.
pub(crate) fn merge_preference_subset(
    source: &Value,
    target: &mut Value,
    paths: &[&str],
) -> Vec<String> {
    let mut migrated_paths = Vec::new();
    for dotted_path in paths {
        if let Some(value) = get_path(source, dotted_path) {
            set_path(target, dotted_path, value.clone());
            migrated_paths.push((*dotted_path).to_string());
        }
    }
    migrated_paths
}

/// Migrate the selected Preferences subset into the target profile.
pub(crate) fn migrate_preferences(
    source_profile_dir: &Path,
    target_profile_dir: &Path,
) -> Result<ClassOutcome> {
    let source_path = source_profile_dir.join("Preferences");
    if !path_exists(&source_path) {
        return Ok(ClassOutcome::skipped(MigrationEntry::new(
            "preferences",
            "Preferences",
            "source-missing",
        )));
    }
    let contents = fs::read_to_string(&source_path)
        .with_context(|| format!("Could not read {}", source_path.display()))?;
    let source: Value = serde_json::from_str(&contents)
        .with_context(|| format!("Invalid JSON in {}", source_path.display()))?;
    let target_path = target_profile_dir.join("Preferences");
    let mut target = fs::read_to_string(&target_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<Value>(&contents).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()));
    let migrated_paths =
        merge_preference_subset(&source, &mut target, &MIGRATED_PREFERENCE_PATHS);
    fs::create_dir_all(target_profile_dir)
        .with_context(|| format!("Could not create {}", target_profile_dir.display()))?;
    fs::write(&target_path, serde_json::to_string(&target)?)
        .with_context(|| format!("Could not write {}", target_path.display()))?;
    Ok(ClassOutcome::migrated(migrated_paths.len() as u64))
}
