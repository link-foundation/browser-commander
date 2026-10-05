//! Safari source-to-Chromium translation with per-class outcomes.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::Value;

use super::{
    chromium_writers, firefox, safari, ClassOutcome, MigrateProfileOptions, MigrationEntry,
    MigrationKeys,
};

fn find_store(profile: &Path, name: &str, legacy: Option<&Path>) -> Result<Option<PathBuf>> {
    let mut candidates = vec![profile.join("Safari").join(name), profile.join(name)];
    if let Some(legacy) = legacy {
        candidates.push(legacy.join(name));
    }
    for candidate in candidates {
        match safari::with_safari_access(&candidate, || Ok(std::fs::metadata(&candidate)?)) {
            Ok(_) => return Ok(Some(candidate)),
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|cause| cause.kind() == std::io::ErrorKind::NotFound) => {}
            Err(error) => return Err(error),
        }
    }
    Ok(None)
}

pub(crate) fn migrate_safari_class(
    type_: &str,
    profile: &Path,
    options: &MigrateProfileOptions,
    keys: Option<&MigrationKeys>,
    legacy: Option<&Path>,
) -> Result<ClassOutcome> {
    let skipped = |reason| {
        ClassOutcome::skipped(MigrationEntry::new(
            type_,
            profile.display().to_string(),
            reason,
        ))
    };
    if type_ == "preferences" || type_ == "extensions" {
        return Ok(ClassOutcome::skipped(
            MigrationEntry::new(
                type_,
                profile.display().to_string(),
                "safari-class-not-supported",
            )
            .with_detail("Safari preferences and extensions do not use Chromium formats."),
        ));
    }
    if type_ == "passwords" {
        let Some(csv) = &options.password_csv else {
            return Ok(ClassOutcome::skipped(MigrationEntry::new(type_,profile.display().to_string(),"safari-password-export-required").with_detail("Export Passwords from Safari or the Passwords app to CSV, then supply password_csv (CLI: --password-csv).")));
        };
        let entries = safari::read_safari_passwords(csv, &options.domains)?;
        let Some(target_key) = keys.and_then(|keys| keys.target_key.as_deref()) else {
            return Ok(ClassOutcome::skipped(MigrationEntry::new(type_, profile.display().to_string(), "target-key-unavailable")
                .with_detail("Supply the dedicated target profile encryption key; no plaintext passwords are written.")));
        };
        let entries = entries
            .into_iter()
            .map(|entry| firefox::DecryptedLogin {
                origin: Some(entry.origin),
                username: entry.username,
                password: entry.password,
            })
            .collect::<Vec<_>>();
        let migrated = firefox::write_chromium_passwords(
            &options.to,
            &entries,
            &firefox::FirefoxPasswordKeys {
                platform: &options.platform,
                target_key,
                target_prefix: keys.and_then(|keys| keys.target_prefix.as_deref()),
                primary_password: &[],
            },
        )?;
        return Ok(ClassOutcome::migrated(migrated));
    }
    let Some(filename) = find_store(
        profile,
        if type_ == "bookmarks" {
            "Bookmarks.plist"
        } else {
            "History.db"
        },
        legacy,
    )?
    else {
        return Ok(skipped("source-missing"));
    };
    if type_ == "bookmarks" {
        fn has_reading_list(nodes: &[Value]) -> bool {
            nodes.iter().any(|node| {
                node["readingList"] == true
                    || node["children"]
                        .as_array()
                        .is_some_and(|children| has_reading_list(children))
            })
        }
        let entries = safari::read_safari_bookmarks(&filename)?;
        let migrated = chromium_writers::write_chromium_bookmarks(&options.to, &entries)?;
        let mut outcome = ClassOutcome::migrated(migrated);
        if has_reading_list(&entries) {
            outcome.warnings.push(MigrationEntry::new(type_, filename.display().to_string(), "safari-reading-list-translated")
                .with_detail("Reading-list URLs become bookmarks; read status and preview metadata are not translated."));
        }
        return Ok(outcome);
    }
    let migrated = chromium_writers::write_chromium_history(
        &options.to,
        &safari::read_safari_history(&filename, &options.domains)?,
    )?;
    Ok(ClassOutcome::migrated(migrated))
}
