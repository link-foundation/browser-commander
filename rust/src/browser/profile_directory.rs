//! Fresh user data directories for every launch (issues #101 and #103).
//!
//! Mirrors `js/src/browser/profile-directory.js`.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};

/// Chrome skips its first-run experience when this file exists in the user
/// data directory; it is what Chrome itself writes after the first run.
///
/// Writing it keeps `--no-first-run` off the command line (issue #103), and it
/// is required for a headful launch at all: without it the first-run dialog
/// holds startup and the DevTools endpoint never appears.
pub const FIRST_RUN_SENTINEL: &str = "First Run";

/// Chrome's profile-wide settings file, next to the profile directories.
pub const LOCAL_STATE_FILE: &str = "Local State";
pub const PREFERENCES_FILE: &str = "Preferences";

/// Local State written into a brand-new user data directory.
///
/// With only the First Run sentinel, Chrome treats a new directory like a
/// browser that was just updated and opens a "What's new" tab that takes the
/// foreground after the engine has attached. Chrome skips the tab when
/// `browser.last_whats_new_version` is not older than the running version; a
/// milestone no release has reached keeps it closed.
///
/// Microsoft Edge ignores that key and opens its own first-run tab,
/// `edge://welcome-edge/`, which takes the foreground the same way; it is
/// skipped once Edge has recorded `fre.has_user_seen_fre` (measured with Edge
/// 153, experiments/issue-103/edge-first-run.sh). Chrome ignores the key.
pub const INITIAL_LOCAL_STATE: &str =
    r#"{"browser":{"last_whats_new_version":9999},"fre":{"has_user_seen_fre":true}}"#;

/// Prefix of the fresh profiles Browser Commander creates and deletes.
pub const TEMPORARY_PROFILE_PREFIX: &str = "browser-commander-profile-";

const REMOVE_ATTEMPTS: usize = 5;
const REMOVE_RETRY_DELAY: Duration = Duration::from_millis(200);

/// Make sure a user data directory exists and has the First Run sentinel.
///
/// An existing sentinel is left alone, so a profile Chrome already used keeps
/// its content, and Local State is only written when Chrome has not written
/// one yet.
pub fn prepare_user_data_dir(user_data_dir: &Path) -> Result<PathBuf> {
    prepare_user_data_dir_with_first_run(user_data_dir, false)
}

/// Prepare a profile, optionally leaving Chromium's first-run flow enabled.
pub fn prepare_user_data_dir_with_first_run(
    user_data_dir: &Path,
    first_run: bool,
) -> Result<PathBuf> {
    fs::create_dir_all(user_data_dir).with_context(|| {
        format!(
            "Could not create user data directory {}",
            user_data_dir.display()
        )
    })?;
    if !first_run {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(user_data_dir.join(FIRST_RUN_SENTINEL))
            .with_context(|| format!("Could not write {FIRST_RUN_SENTINEL} sentinel"))?;
    }
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(user_data_dir.join(LOCAL_STATE_FILE))
    {
        Ok(mut file) => file
            .write_all(INITIAL_LOCAL_STATE.as_bytes())
            .with_context(|| format!("Could not write {LOCAL_STATE_FILE}"))?,
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(anyhow!(error).context(format!("Could not write {LOCAL_STATE_FILE}")))
        }
    }
    configure_user_data_dir(user_data_dir, None, &json!({}), &json!({}))?;
    Ok(user_data_dir.to_path_buf())
}

fn merge_json(target: &mut Value, source: &Value) -> Result<()> {
    let source = source
        .as_object()
        .ok_or_else(|| anyhow!("profile settings must be a JSON object"))?;
    let target = target
        .as_object_mut()
        .ok_or_else(|| anyhow!("profile file must contain a JSON object"))?;
    for (key, value) in source {
        if value.is_object() {
            let entry = target.entry(key).or_insert_with(|| json!({}));
            if !entry.is_object() {
                *entry = json!({});
            }
            merge_json(entry, value)?;
        } else {
            target.insert(key.clone(), value.clone());
        }
    }
    Ok(())
}

fn merge_json_file(path: &Path, defaults: &Value, overrides: &Value) -> Result<()> {
    let mut current = if path.exists() {
        serde_json::from_slice(&fs::read(path)?)
            .with_context(|| format!("Could not parse {}", path.display()))?
    } else {
        json!({})
    };
    merge_json(&mut current, defaults)?;
    merge_json(&mut current, overrides)?;
    fs::create_dir_all(
        path.parent()
            .ok_or_else(|| anyhow!("invalid profile path"))?,
    )?;
    fs::write(path, serde_json::to_vec(&current)?)?;
    Ok(())
}

/// Apply settings after profile creation, migration, or snapshot copy.
pub fn configure_user_data_dir(
    user_data_dir: &Path,
    default_browser_check: Option<bool>,
    preferences: &Value,
    local_state: &Value,
) -> Result<()> {
    configure_user_data_dir_for_profile(
        user_data_dir,
        "Default",
        default_browser_check,
        preferences,
        local_state,
    )
}

/// Apply preferences to a selected profile, including a snapshot's `Profile 1`.
pub fn configure_user_data_dir_for_profile(
    user_data_dir: &Path,
    profile: &str,
    default_browser_check: Option<bool>,
    preferences: &Value,
    local_state: &Value,
) -> Result<()> {
    if profile.is_empty() || matches!(profile, "." | "..") || profile.contains(['/', '\\', '\0']) {
        return Err(anyhow!(
            "profile must be a directory name such as Default or Profile 1"
        ));
    }
    let mut overrides = preferences.clone();
    for key in [
        "session.restore_on_startup",
        "session.startup_urls",
        "homepage",
        "homepage_is_newtabpage",
        "browser.show_home_button",
        "extensions.settings",
        "default_search_provider_data",
    ] {
        let pointer = format!("/{}", key.replace('.', "/"));
        if preferences.pointer(&pointer).is_some() || preferences.get(key).is_some() {
            tracing::warn!(preference = key, "Chrome protects this value in Secure Preferences and may reset it; use browser settings or managed policy");
        }
    }
    if let Some(browser) = overrides.get("browser") {
        if !browser.is_object() {
            return Err(anyhow!("preferences.browser must be a JSON object"));
        }
    }
    if let Some(check) = default_browser_check {
        let browser = overrides
            .as_object_mut()
            .ok_or_else(|| anyhow!("preferences must be a JSON object"))?
            .entry("browser")
            .or_insert_with(|| json!({}));
        browser
            .as_object_mut()
            .ok_or_else(|| anyhow!("preferences.browser must be a JSON object"))?
            .insert("check_default_browser".to_string(), json!(check));
    }
    merge_json_file(
        &user_data_dir.join(profile).join(PREFERENCES_FILE),
        &json!({"browser":{"check_default_browser":false}}),
        &overrides,
    )?;
    let check = overrides
        .pointer("/browser/check_default_browser")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let count = if check { 0 } else { 5 };
    merge_json_file(
        &user_data_dir.join(LOCAL_STATE_FILE),
        &json!({"browser":{"default_browser_infobar_declined_count":count,"default_browser_declined_count":count}}),
        local_state,
    )?;
    Ok(())
}

fn unique_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{nanos:x}-{count}", std::process::id())
}

/// Create a fresh, empty profile for one launch inside `parent` (the system
/// temporary directory when `None`).
pub fn create_temporary_user_data_dir(parent: Option<&Path>) -> Result<PathBuf> {
    create_temporary_user_data_dir_with_first_run(parent, false)
}

/// Create a temporary profile, optionally leaving first-run enabled.
pub fn create_temporary_user_data_dir_with_first_run(
    parent: Option<&Path>,
    first_run: bool,
) -> Result<PathBuf> {
    let parent = parent.map_or_else(std::env::temp_dir, Path::to_path_buf);
    fs::create_dir_all(&parent)
        .with_context(|| format!("Could not create {}", parent.display()))?;
    loop {
        let candidate = parent.join(format!("{TEMPORARY_PROFILE_PREFIX}{}", unique_suffix()));
        match fs::create_dir(&candidate) {
            Ok(()) => return prepare_user_data_dir_with_first_run(&candidate, first_run),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(anyhow!(error).context(format!(
                    "Could not create a temporary profile in {}",
                    parent.display()
                )))
            }
        }
    }
}

/// Delete a temporary profile.
///
/// Chrome can still be flushing files for a moment after its process exits,
/// so removal is retried. A directory that is already gone is not an error.
pub async fn remove_user_data_dir(user_data_dir: &Path) -> Result<()> {
    let mut attempt = 0;
    loop {
        match fs::remove_dir_all(user_data_dir) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
            Err(error) => {
                attempt += 1;
                if attempt >= REMOVE_ATTEMPTS {
                    return Err(anyhow!(error).context(format!(
                        "Could not remove temporary profile {}",
                        user_data_dir.display()
                    )));
                }
                tokio::time::sleep(REMOVE_RETRY_DELAY).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn temporary_profiles_are_seeded_and_removed() {
        let directory = create_temporary_user_data_dir(None).unwrap();
        let name = directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(name.starts_with(TEMPORARY_PROFILE_PREFIX), "{name}");
        assert_eq!(
            fs::read_to_string(directory.join(FIRST_RUN_SENTINEL)).unwrap(),
            ""
        );
        let prepared_state: Value =
            serde_json::from_slice(&fs::read(directory.join(LOCAL_STATE_FILE)).unwrap()).unwrap();
        assert_eq!(
            prepared_state["browser"]["default_browser_declined_count"],
            5
        );
        // Chrome's What's New tab and Edge's first-run tab both stay closed.
        let local_state: serde_json::Value = serde_json::from_str(INITIAL_LOCAL_STATE).unwrap();
        assert_eq!(
            local_state,
            serde_json::json!({
                "browser": {"last_whats_new_version": 9999},
                "fre": {"has_user_seen_fre": true},
            })
        );
        let preferences: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(directory.join("Default").join("Preferences")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            preferences,
            serde_json::json!({"browser":{"check_default_browser":false}})
        );
        let other = create_temporary_user_data_dir(None).unwrap();
        assert_ne!(directory, other);
        remove_user_data_dir(&directory).await.unwrap();
        remove_user_data_dir(&other).await.unwrap();
        assert!(!directory.exists());
        remove_user_data_dir(&directory).await.unwrap();
    }

    #[tokio::test]
    async fn preparing_keeps_existing_profile_files() {
        let directory = create_temporary_user_data_dir(None).unwrap();
        fs::write(directory.join(FIRST_RUN_SENTINEL), "kept").unwrap();
        fs::write(directory.join(LOCAL_STATE_FILE), "{}").unwrap();
        prepare_user_data_dir(&directory).unwrap();
        assert_eq!(
            fs::read_to_string(directory.join(FIRST_RUN_SENTINEL)).unwrap(),
            "kept"
        );
        let state: Value =
            serde_json::from_slice(&fs::read(directory.join(LOCAL_STATE_FILE)).unwrap()).unwrap();
        assert_eq!(state["browser"]["default_browser_declined_count"], 5);
        remove_user_data_dir(&directory).await.unwrap();
    }

    #[tokio::test]
    async fn profile_settings_merge_and_named_override() {
        let directory = create_temporary_user_data_dir(None).unwrap();
        let path = directory.join("Default").join(PREFERENCES_FILE);
        fs::write(&path, r#"{"browser":{"check_default_browser":true,"show_home_button":false},"intl":{"accept_languages":"en"}}"#).unwrap();
        configure_user_data_dir(
            &directory,
            Some(false),
            &json!({"browser":{"show_home_button":true}}),
            &json!({"browser":{"extra":1}}),
        )
        .unwrap();
        let preferences: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            preferences,
            json!({
                "browser":{"check_default_browser":false,"show_home_button":true},
                "intl":{"accept_languages":"en"}
            })
        );
        let local_state: Value =
            serde_json::from_slice(&fs::read(directory.join(LOCAL_STATE_FILE)).unwrap()).unwrap();
        assert_eq!(
            local_state["browser"],
            json!({"last_whats_new_version":9999,"default_browser_infobar_declined_count":5,"default_browser_declined_count":5,"extra":1})
        );
        remove_user_data_dir(&directory).await.unwrap();
    }

    #[tokio::test]
    async fn first_run_can_be_enabled_in_a_fresh_profile() {
        let directory = std::env::temp_dir().join(format!("first-run-test-{}", unique_suffix()));
        prepare_user_data_dir_with_first_run(&directory, true).unwrap();
        assert!(!directory.join(FIRST_RUN_SENTINEL).exists());
        remove_user_data_dir(&directory).await.unwrap();
    }

    #[test]
    fn rejects_a_non_object_browser_preference() {
        let directory =
            std::env::temp_dir().join(format!("profile-settings-test-{}", unique_suffix()));
        let result =
            configure_user_data_dir(&directory, None, &json!({"browser": false}), &json!({}));
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("preferences.browser"));
        assert!(!directory.exists());
    }
}
