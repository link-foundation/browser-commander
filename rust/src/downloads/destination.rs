//! Where managed downloads are written (issue #88).
//!
//! The directory is resolved, created and probed for writability *before* the
//! first download starts, because a permission problem discovered after a click
//! looks like a missing file and gets blamed on the page.
//!
//! # Example
//!
//! ```rust
//! use browser_commander::downloads::{
//!     prepare_download_directory, resolve_download_directory, DownloadDirectoryPreset,
//! };
//!
//! let root = resolve_download_directory(Some(DownloadDirectoryPreset::TEMPORARY))?;
//! let usable = prepare_download_directory(&root)?;
//! assert!(usable.is_dir());
//! # Ok::<(), browser_commander::downloads::DownloadError>(())
//! ```

use std::path::{Path, PathBuf};

use crate::downloads::DownloadError;

/// Presets accepted in place of an absolute path.
pub struct DownloadDirectoryPreset;

impl DownloadDirectoryPreset {
    /// The folder the person running the browser downloads into.
    pub const USER_DOWNLOADS: &'static str = "user-downloads";
    /// A per-machine temporary folder, for runs that keep nothing.
    pub const TEMPORARY: &'static str = "temporary";
}

/// Owner-only file mode for saved artifacts.
pub const ARTIFACT_FILE_MODE: u32 = 0o600;

/// Owner-only directory mode for the download root.
pub const ARTIFACT_DIRECTORY_MODE: u32 = 0o700;

/// Apply an owner-only mode, on the systems that have one.
///
/// Windows has no POSIX mode bits, so there is nothing to apply and nothing to
/// fail on; the file is still created inside a directory the caller chose.
pub(crate) fn restrict(path: &Path, mode: u32) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    {
        let _ = (path, mode);
    }
    Ok(())
}

/// Resolve a download directory setting to an absolute path.
///
/// # Arguments
///
/// * `directory` - Absolute path, [`DownloadDirectoryPreset::USER_DOWNLOADS`]
///   or [`DownloadDirectoryPreset::TEMPORARY`]; `None` means the user's folder
///
/// # Returns
///
/// An absolute directory path.
///
/// # Errors
///
/// Returns [`DownloadError::RelativeDirectory`] when a caller-supplied path is
/// not absolute, because a relative download directory means a different folder
/// for every process that happens to have a different working directory.
pub fn resolve_download_directory(directory: Option<&str>) -> Result<PathBuf, DownloadError> {
    let directory = directory.unwrap_or(DownloadDirectoryPreset::USER_DOWNLOADS);

    if directory == DownloadDirectoryPreset::TEMPORARY {
        return Ok(std::env::temp_dir().join("browser-commander-downloads"));
    }

    if directory == DownloadDirectoryPreset::USER_DOWNLOADS {
        // `dirs` reads `user-dirs.dirs` on Linux, which is what makes
        // `user-downloads` mean the folder a person actually uses rather than
        // an English path that happens to exist next to it.
        return Ok(dirs::download_dir().unwrap_or_else(|| {
            dirs::home_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("Downloads")
        }));
    }

    if directory.is_empty() || !Path::new(directory).is_absolute() {
        return Err(DownloadError::RelativeDirectory {
            directory: directory.to_string(),
        });
    }

    Ok(PathBuf::from(directory))
}

/// Create the download directory and prove it can be written to.
///
/// A directory that exists is not the same as a directory we may write in, so
/// the probe writes and removes a file rather than trusting the mode bits.
///
/// # Arguments
///
/// * `root` - Download directory
///
/// # Returns
///
/// The same directory, once it is usable.
///
/// # Errors
///
/// Returns [`DownloadError::DirectoryNotCreated`] or
/// [`DownloadError::DirectoryNotWritable`].
pub fn prepare_download_directory(root: &Path) -> Result<PathBuf, DownloadError> {
    // A directory the caller already had is theirs, mode bits included:
    // pointing downloads at `~/Downloads` must not quietly turn it into an
    // owner-only folder. Only a directory this call creates is restricted.
    let existed = root.is_dir();
    std::fs::create_dir_all(root).map_err(|source| DownloadError::DirectoryNotCreated {
        root: root.to_path_buf(),
        source,
    })?;
    if !existed {
        let _ = restrict(root, ARTIFACT_DIRECTORY_MODE);
    }

    let probe = root.join(format!(".browser-commander-probe-{}", std::process::id()));
    let written = std::fs::write(&probe, b"");
    let _ = std::fs::remove_file(&probe);
    written.map_err(|source| DownloadError::DirectoryNotWritable {
        root: root.to_path_buf(),
        source,
    })?;

    Ok(root.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::downloads::test_support::TempDir;

    #[test]
    fn resolves_the_temporary_preset_under_the_system_temp_folder() {
        let resolved =
            resolve_download_directory(Some(DownloadDirectoryPreset::TEMPORARY)).unwrap();
        assert_eq!(
            resolved,
            std::env::temp_dir().join("browser-commander-downloads")
        );
    }

    #[test]
    fn resolves_the_user_folder_by_default() {
        let implicit = resolve_download_directory(None).unwrap();
        let explicit =
            resolve_download_directory(Some(DownloadDirectoryPreset::USER_DOWNLOADS)).unwrap();
        assert_eq!(implicit, explicit);
        assert!(implicit.is_absolute(), "{implicit:?} is not absolute");
    }

    #[test]
    fn keeps_an_absolute_path_the_caller_chose() {
        // Built from the temporary directory rather than written as a literal:
        // `/tmp/bc-explicit` has no drive, and a path with no drive is not
        // absolute on Windows, so the literal would be testing the rejection
        // below instead of this.
        let chosen = std::env::temp_dir().join("bc-explicit");

        let resolved = resolve_download_directory(Some(chosen.to_str().unwrap())).unwrap();

        assert_eq!(resolved, chosen);
    }

    #[test]
    fn refuses_a_relative_directory() {
        let error = resolve_download_directory(Some("downloads")).unwrap_err();
        assert!(
            error.to_string().contains("must be absolute"),
            "unexpected message: {error}"
        );
    }

    #[test]
    fn creates_the_directory_and_proves_it_is_writable() {
        let temp = TempDir::new("bc-destination");
        let root = temp.path().join("nested/downloads");

        let prepared = prepare_download_directory(&root).unwrap();

        assert_eq!(prepared, root);
        assert!(root.is_dir());
        // The probe file is the evidence, and it must not be left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert!(leftovers.is_empty(), "left behind {leftovers:?}");
    }

    #[cfg(unix)]
    #[test]
    fn reports_a_directory_it_cannot_write_into() {
        let temp = TempDir::new("bc-unwritable");
        let root = temp.path().join("read-only");
        std::fs::create_dir_all(&root).unwrap();
        restrict(&root, 0o500).unwrap();

        // Mode bits do not stop root, and CI images often run as root, so the
        // test asks the filesystem whether this user is actually blocked
        // rather than assuming the chmod meant something.
        if std::fs::write(root.join("probe"), b"").is_ok() {
            restrict(&root, 0o700).unwrap();
            return;
        }

        let error = prepare_download_directory(&root).unwrap_err();

        // Restored before the assertion so the temporary directory can be
        // removed however this test ends.
        restrict(&root, 0o700).unwrap();
        assert!(
            error.to_string().contains("is not writable"),
            "unexpected message: {error}"
        );
    }
}
