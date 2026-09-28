//! Fresh user data directories for every launch (issues #101 and #103).
//!
//! Mirrors `js/src/browser/profile-directory.js`.

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};

/// Chrome skips its first-run experience when this file exists in the user
/// data directory; it is what Chrome itself writes after the first run.
///
/// Writing it keeps `--no-first-run` off the command line (issue #103), and it
/// is required for a headful launch at all: without it the first-run dialog
/// holds startup and the DevTools endpoint never appears.
pub const FIRST_RUN_SENTINEL: &str = "First Run";

/// Chrome's profile-wide settings file, next to the profile directories.
pub const LOCAL_STATE_FILE: &str = "Local State";

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
    fs::create_dir_all(user_data_dir).with_context(|| {
        format!(
            "Could not create user data directory {}",
            user_data_dir.display()
        )
    })?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(user_data_dir.join(FIRST_RUN_SENTINEL))
        .with_context(|| format!("Could not write {FIRST_RUN_SENTINEL} sentinel"))?;
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
    Ok(user_data_dir.to_path_buf())
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
    let parent = parent.map_or_else(std::env::temp_dir, Path::to_path_buf);
    fs::create_dir_all(&parent)
        .with_context(|| format!("Could not create {}", parent.display()))?;
    loop {
        let candidate = parent.join(format!("{TEMPORARY_PROFILE_PREFIX}{}", unique_suffix()));
        match fs::create_dir(&candidate) {
            Ok(()) => return prepare_user_data_dir(&candidate),
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
        assert_eq!(
            fs::read_to_string(directory.join(LOCAL_STATE_FILE)).unwrap(),
            INITIAL_LOCAL_STATE
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
        assert_eq!(
            fs::read_to_string(directory.join(LOCAL_STATE_FILE)).unwrap(),
            "{}"
        );
        remove_user_data_dir(&directory).await.unwrap();
    }
}
