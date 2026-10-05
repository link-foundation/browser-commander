//! Read-only copies of live Chromium profiles and native snapshot launches.

use std::fs;
use std::io::Read;
use std::ops::Deref;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::browser_profiles::{browser_profile_root, current_platform, normalize_cookie_browser};
use super::browser_sources::browser_family;
use super::migration::sqlite_snapshot::with_database_snapshot;
use super::profile_directory::{
    configure_user_data_dir_for_profile, create_temporary_user_data_dir, prepare_user_data_dir,
};
use super::real_browser::{launch_real_browser_owned, RealBrowserLaunchResult, RealBrowserOptions};

/// Source of a snapshot. The source browser may remain open throughout.
#[derive(Debug, Clone)]
pub struct SnapshotOptions {
    /// Chromium-family browser (`chrome`, `edge`, `brave` or `chromium`).
    pub browser: String,
    /// On-disk profile name, such as `Default` or `Profile 1`.
    pub profile: String,
    /// Source user-data root; `None` discovers the installed browser's root.
    pub user_data_dir: Option<PathBuf>,
}

impl Default for SnapshotOptions {
    fn default() -> Self {
        Self {
            browser: "chrome".into(),
            profile: "Default".into(),
            user_data_dir: None,
        }
    }
}

/// Origin of a profile copy, using the same JSON names as JavaScript/Python.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSource {
    /// Normalized browser name.
    pub browser: String,
    /// Selected profile name.
    pub profile: String,
    /// Source user-data root.
    pub user_data_dir: PathBuf,
}

/// Copied files and consistent SQLite databases.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnapshotCounts {
    /// Successfully copied files, including databases.
    pub files: u64,
    /// SQLite databases copied with the online backup API.
    pub databases: u64,
}

/// An excluded or unreadable item, relative to the user-data root.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotSkipped {
    /// Relative file/directory name.
    pub item: String,
    /// Stable exclusion reason.
    pub reason: String,
    /// Error details for unreadable items.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Snapshot result. The caller owns `target` unless passed to `launch_snapshot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotReport {
    /// Original browser/profile.
    pub source: SnapshotSource,
    /// Copied user-data root.
    pub target: PathBuf,
    /// Successful copies.
    pub copied: SnapshotCounts,
    /// Excluded/unreadable files.
    pub skipped: Vec<SnapshotSkipped>,
    /// Nonfatal compatibility warnings.
    pub warnings: Vec<String>,
}

/// Exclusions shared with the JavaScript and Python snapshotters.
pub fn snapshot_skip_reason(relative: &str) -> Option<&'static str> {
    let name = relative.rsplit('/').next().unwrap_or(relative);
    if name.starts_with("Singleton") || matches!(name, "lockfile" | "LOCK") {
        Some("lock")
    } else if matches!(
        name,
        "Cache"
            | "Code Cache"
            | "GPUCache"
            | "DawnCache"
            | "DawnGraphiteCache"
            | "DawnWebGPUCache"
            | "GrShaderCache"
            | "ShaderCache"
    ) || relative.ends_with("Service Worker/CacheStorage")
    {
        Some("cache")
    } else if name == "Crashpad" {
        Some("crash-reports")
    } else if matches!(
        name,
        "Sessions" | "Current Session" | "Current Tabs" | "Last Session" | "Last Tabs"
    ) {
        Some("session")
    } else if ["-journal", "-wal", "-shm"]
        .iter()
        .any(|suffix| name.ends_with(suffix))
    {
        Some("sqlite-sidecar")
    } else {
        None
    }
}

fn skip(report: &mut SnapshotReport, relative: &Path, reason: &str, detail: Option<String>) {
    report.skipped.push(SnapshotSkipped {
        item: relative.to_string_lossy().replace('\\', "/"),
        reason: reason.into(),
        detail,
    });
}

fn copy_file(source: &Path, target: &Path, report: &mut SnapshotReport) -> Result<()> {
    fs::create_dir_all(
        target
            .parent()
            .ok_or_else(|| anyhow!("Invalid snapshot file"))?,
    )?;
    let mut header = [0; 16];
    let count = fs::File::open(source)?.read(&mut header)?;
    if count == 16 && &header == b"SQLite format 3\0" {
        with_database_snapshot(source, |snapshot| {
            let database = rusqlite::Connection::open_with_flags(
                snapshot,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )?;
            database.backup(rusqlite::MAIN_DB, target, None)?;
            rusqlite::Connection::open(target)?.execute_batch("PRAGMA journal_mode=DELETE")?;
            Ok(())
        })?;
        report.copied.databases += 1;
    } else {
        fs::copy(source, target)?;
    }
    report.copied.files += 1;
    Ok(())
}

fn copy_item(relative: &Path, report: &mut SnapshotReport) -> Result<()> {
    let source = report.source.user_data_dir.join(relative);
    let target = report.target.join(relative);
    let metadata = fs::symlink_metadata(&source)?;
    let item = relative.to_string_lossy().replace('\\', "/");
    let reason = snapshot_skip_reason(&item)
        .or_else(|| metadata.file_type().is_symlink().then_some("symlink"));
    if let Some(reason) = reason {
        skip(report, relative, reason, None);
    } else if metadata.is_dir() {
        fs::create_dir_all(&target)?;
        let mut entries = fs::read_dir(source)?.collect::<std::io::Result<Vec<_>>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let child = relative.join(entry.file_name());
            if let Err(error) = copy_item(&child, report) {
                skip(report, &child, "unreadable", Some(error.to_string()));
            }
        }
    } else if metadata.is_file() {
        if let Err(error) = copy_file(&source, &target, report) {
            let _ = fs::remove_file(&target);
            return Err(error);
        }
    } else {
        skip(report, relative, "special-file", None);
    }
    Ok(())
}

// Resolve existing ancestors before creating a destination, so symlinks cannot
// point a seemingly external destination back into the source profile.
fn resolved_destination(path: &Path) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    let mut ancestor = normalized.as_path();
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| anyhow!("Invalid snapshot destination"))?;
    }
    Ok(ancestor
        .canonicalize()?
        .join(normalized.strip_prefix(ancestor)?))
}

/// Copy one live Chromium profile without modifying the original. SQLite WAL
/// commits are folded into standalone databases; caches, locks, sessions,
/// sidecars, symlinks and special files are skipped and reported. An explicit
/// destination must be empty and outside the source.
pub fn snapshot_user_data_dir(
    options: &SnapshotOptions,
    to: Option<&Path>,
) -> Result<SnapshotReport> {
    let browser = normalize_cookie_browser(&options.browser)?;
    if browser_family(browser)? != "chromium" {
        return Err(anyhow!(
            "snapshot attach requires a Chromium-family browser"
        ));
    }
    if options.profile.is_empty()
        || matches!(options.profile.as_str(), "." | "..")
        || options.profile.contains(['/', '\\', '\0'])
    {
        return Err(anyhow!(
            "profile must be a directory name such as Default or Profile 1"
        ));
    }
    let source = match &options.user_data_dir {
        Some(source) => source.clone(),
        None => browser_profile_root(
            browser,
            current_platform(),
            &dirs::home_dir().ok_or_else(|| anyhow!("No home directory"))?,
        )?,
    };
    let metadata = fs::symlink_metadata(source.join(&options.profile))
        .context("Could not read source profile")?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(anyhow!("source profile must be a directory, not a symlink"));
    }
    let target = if let Some(to) = to {
        let target = resolved_destination(to)?;
        if target.starts_with(source.canonicalize()?) {
            return Err(anyhow!("snapshot target must not be inside the source"));
        }
        fs::create_dir_all(&target)?;
        if fs::read_dir(&target)?.next().is_some() {
            return Err(anyhow!("snapshot target must be empty"));
        }
        target
    } else {
        create_temporary_user_data_dir(None)?
    };
    let mut report = SnapshotReport {
        source: SnapshotSource {
            browser: browser.into(),
            profile: options.profile.clone(),
            user_data_dir: source,
        },
        target,
        copied: SnapshotCounts::default(),
        skipped: vec![],
        warnings: vec![],
    };
    let result = (|| -> Result<()> {
        if report.source.user_data_dir.join("Local State").exists() {
            copy_item(Path::new("Local State"), &mut report)?;
        }
        copy_item(Path::new(&options.profile), &mut report)?;
        prepare_user_data_dir(&report.target)?;
        let preferences = report.target.join(&options.profile).join("Preferences");
        let mut prefs: Value = if preferences.exists() {
            serde_json::from_slice(&fs::read(&preferences)?)?
        } else {
            json!({})
        };
        let object = prefs
            .as_object_mut()
            .ok_or_else(|| anyhow!("Preferences must contain a JSON object"))?;
        let profile = object.entry("profile").or_insert_with(|| json!({}));
        let profile = profile
            .as_object_mut()
            .ok_or_else(|| anyhow!("Preferences.profile must contain a JSON object"))?;
        profile.insert("exit_type".into(), json!("Normal"));
        profile.insert("exited_cleanly".into(), json!(true));
        fs::write(&preferences, serde_json::to_vec(&prefs)?)?;
        configure_user_data_dir_for_profile(
            &report.target,
            &options.profile,
            None,
            &json!({}),
            &json!({}),
        )?;
        Ok(())
    })();
    if let Err(error) = result {
        if to.is_none() {
            let _ = fs::remove_dir_all(&report.target);
        }
        return Err(error);
    }
    Ok(report)
}

/// Connected native browser plus the snapshot report. Browser handles and
/// `close()` are available through `Deref` to the ordinary launch result.
pub struct SnapshotLaunchResult {
    /// The browser launch owns and cleans up its temporary profile.
    pub launch: RealBrowserLaunchResult,
    /// Copy report; the original profile is never written to.
    pub snapshot: SnapshotReport,
}

impl Deref for SnapshotLaunchResult {
    type Target = RealBrowserLaunchResult;
    fn deref(&self) -> &Self::Target {
        &self.launch
    }
}

pub(crate) struct OwnedCopy {
    pub(crate) report: SnapshotReport,
    pub(crate) armed: bool,
}

pub(crate) async fn copy_owned_snapshot(source: SnapshotOptions) -> Result<OwnedCopy> {
    tokio::task::spawn_blocking(move || {
        snapshot_user_data_dir(&source, None).map(|report| OwnedCopy {
            report,
            armed: true,
        })
    })
    .await?
}
impl Drop for OwnedCopy {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_dir_all(&self.report.target);
        }
    }
}

/// Launch an owned snapshot with any CDP engine. The ordinary launch closer
/// and exit listener delete the copy on shutdown or connection failure.
pub async fn launch_snapshot(
    source: SnapshotOptions,
    mut options: RealBrowserOptions,
) -> Result<SnapshotLaunchResult> {
    if options.user_data_dir.is_some() || options.migrate_from.is_some() {
        return Err(anyhow!(
            "snapshot is mutually exclusive with user_data_dir and migrate_from"
        ));
    }
    if options
        .args
        .iter()
        .chain(&options.extra_args)
        .any(|arg| arg.split('=').next() == Some("--profile-directory"))
    {
        return Err(anyhow!(
            "snapshot manages --profile-directory; use SnapshotOptions.profile"
        ));
    }
    let profile = source.profile.clone();
    // If this future is cancelled, dropping the task result removes the copy.
    let mut owned = copy_owned_snapshot(source).await?;
    options.user_data_dir = Some(owned.report.target.clone());
    options.profile_directory = profile.clone();
    options
        .args
        .insert(0, format!("--profile-directory={profile}"));
    let launch = launch_real_browser_owned(options, true).await?;
    let snapshot = owned.report.clone();
    // Transfer ownership to the launch's closer/exit listener.
    owned.armed = false;
    Ok(SnapshotLaunchResult { launch, snapshot })
}
