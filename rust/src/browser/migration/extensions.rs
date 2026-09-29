//! Extension migration, mirroring `js/src/browser/migration/extensions.js`.
//!
//! A Chromium extension lives in two places in a profile: its unpacked files
//! under `Extensions/<id>/<version>/`, and a bookkeeping entry under
//! `extensions.settings.<id>` in `Secure Preferences`. This module copies both.
//!
//! ## Secure Preferences MAC (honest limitation)
//!
//! `Secure Preferences` is protected by a per-entry HMAC ("MAC") seeded with a
//! key baked into the browser binary plus a per-profile/OS identifier. Because
//! that seed differs for the dedicated target profile, a MAC copied from the
//! source will not validate, and Chrome treats that as tampering: it disables
//! the extension on the next launch. We cannot forge a valid MAC, so every
//! migrated extension is reported with the `mac-will-not-validate` warning.
//!
//! References:
//! - <https://chromium.googlesource.com/chromium/src/+/HEAD/services/preferences/tracked/README.md>
//!
//! ## Excluded extensions
//!
//! Policy-installed and component/built-in extensions are never copied; they
//! are identified by the `location` value in the settings entry.

use std::fs;
use std::path::Path;

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::{Map, Value};

use super::fs_utils::{copy_dir_recursive, path_exists, read_json_if_present, OrderedEntries};
use super::{ClassOutcome, MigrationEntry};

/// Chrome's `Manifest::Location` values that are never migrated: COMPONENT (5),
/// EXTERNAL_POLICY_DOWNLOAD (7), EXTERNAL_POLICY (9), EXTERNAL_COMPONENT (10).
const EXCLUDED_LOCATIONS: [f64; 4] = [5.0, 7.0, 9.0, 10.0];

const SECURE_PREFERENCES: &str = "Secure Preferences";

const MAC_DETAIL: &str = "Extension files and settings were copied, but Chrome computes a per-profile HMAC over Secure Preferences that cannot be reproduced for the target profile. Chrome will likely disable the migrated extensions on first launch; re-enable them or reinstall from the Web Store to restore a valid MAC.";

/// Extensions a settings map allows to migrate, and the ones it excludes with
/// the reason.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct ExtensionSelection {
    pub eligible: Vec<String>,
    pub excluded: Vec<(String, String)>,
}

/// JavaScript `Number(value)` for the JSON shapes a `location` can take.
fn js_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Some(0.0)
            } else {
                trimmed.parse().ok()
            }
        }
        Value::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        Value::Null => Some(0.0),
        _ => None,
    }
}

fn is_truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// Decide which extension ids are eligible to migrate from a settings map.
pub(crate) fn select_migratable_extensions(settings: &[(String, Value)]) -> ExtensionSelection {
    let mut selection = ExtensionSelection::default();
    for (id, entry) in settings {
        let location = js_number(entry.get("location"));
        if location.is_some_and(|location| EXCLUDED_LOCATIONS.contains(&location)) {
            selection
                .excluded
                .push((id.clone(), "policy-or-component-extension".to_string()));
            continue;
        }
        if entry.get("was_installed_by_default") == Some(&Value::Bool(true))
            && !is_truthy(entry.get("manifest"))
        {
            selection
                .excluded
                .push((id.clone(), "default-extension".to_string()));
            continue;
        }
        selection.eligible.push(id.clone());
    }
    selection
}

#[derive(Deserialize)]
struct SecurePreferencesView {
    extensions: Option<ExtensionsView>,
}

#[derive(Deserialize)]
struct ExtensionsView {
    settings: Option<OrderedEntries>,
}

/// `extensions.settings` from a Secure Preferences file, in document order.
fn read_extension_settings(path: &Path) -> Vec<(String, Value)> {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<SecurePreferencesView>(&contents).ok())
        .and_then(|view| view.extensions)
        .and_then(|extensions| extensions.settings)
        .map(|settings| settings.0)
        .unwrap_or_default()
}

fn list_extension_directories(extensions_dir: &Path) -> Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in fs::read_dir(extensions_dir)
        .with_context(|| format!("Could not read {}", extensions_dir.display()))?
    {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.file_type()?.is_dir() && name != "Temp" {
            names.push(name);
        }
    }
    names.sort();
    Ok(names)
}

fn write_target_settings(
    target_profile_dir: &Path,
    migrated_settings: Vec<(String, Value)>,
) -> Result<()> {
    let target_path = target_profile_dir.join(SECURE_PREFERENCES);
    let mut target = read_json_if_present(&target_path)
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()));
    let root = target.as_object_mut().expect("the target is an object");
    let extensions = root
        .entry("extensions")
        .or_insert_with(|| Value::Object(Map::new()));
    if !extensions.is_object() {
        *extensions = Value::Object(Map::new());
    }
    let extensions = extensions.as_object_mut().expect("extensions is an object");
    let mut settings = extensions
        .get("settings")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    settings.extend(migrated_settings);
    extensions.insert("settings".to_string(), Value::Object(settings));
    fs::create_dir_all(target_profile_dir)
        .with_context(|| format!("Could not create {}", target_profile_dir.display()))?;
    fs::write(&target_path, serde_json::to_string(&target)?)
        .with_context(|| format!("Could not write {}", target_path.display()))
}

/// Migrate extensions from a source profile into the target profile.
pub(crate) fn migrate_extensions(
    source_profile_dir: &Path,
    target_profile_dir: &Path,
) -> Result<ClassOutcome> {
    let source_extensions_dir = source_profile_dir.join("Extensions");
    if !path_exists(&source_extensions_dir) {
        return Ok(ClassOutcome::default());
    }
    let settings = read_extension_settings(&source_profile_dir.join(SECURE_PREFERENCES));

    // Fall back to the on-disk directory listing when there is no settings map
    // (for example a snapshot copied without Secure Preferences).
    let selection = if settings.is_empty() {
        ExtensionSelection {
            eligible: list_extension_directories(&source_extensions_dir)?,
            excluded: Vec::new(),
        }
    } else {
        select_migratable_extensions(&settings)
    };

    let mut outcome = ClassOutcome::default();
    for (id, reason) in &selection.excluded {
        outcome.skipped.push(MigrationEntry::new(
            "extensions",
            id.as_str(),
            reason.as_str(),
        ));
    }

    let target_extensions_dir = target_profile_dir.join("Extensions");
    let mut migrated_settings: Vec<(String, Value)> = Vec::new();
    for id in &selection.eligible {
        let source_dir = source_extensions_dir.join(id);
        if !path_exists(&source_dir) {
            outcome.skipped.push(MigrationEntry::new(
                "extensions",
                id.as_str(),
                "files-missing",
            ));
            continue;
        }
        copy_dir_recursive(&source_dir, &target_extensions_dir.join(id))?;
        if let Some((_, entry)) = settings.iter().find(|(key, _)| key == id) {
            if is_truthy(Some(entry)) {
                migrated_settings.push((id.clone(), entry.clone()));
            }
        }
        outcome.migrated += 1;
    }

    if outcome.migrated > 0 {
        // Best-effort: write the settings entries into the target Secure
        // Preferences so Chrome knows about the extensions. The MAC will not
        // validate for the target profile (see the module comment), so warn.
        if !migrated_settings.is_empty() {
            write_target_settings(target_profile_dir, migrated_settings)?;
        }
        outcome.warnings.push(
            MigrationEntry::new(
                "extensions",
                "Secure Preferences MAC",
                "mac-will-not-validate",
            )
            .with_detail(MAC_DETAIL),
        );
    }
    Ok(outcome)
}
