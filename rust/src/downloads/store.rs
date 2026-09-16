//! Writing a download into the managed directory (issue #88).
//!
//! The rule the whole module exists to keep: a file that appears under its
//! final name is complete and has passed validation. Everything else lives
//! under a `.partial` name and is removed.
//!
//! # Example
//!
//! ```rust,no_run
//! use browser_commander::downloads::{save_download, DownloadSource, SaveRequest};
//!
//! let saved = save_download(SaveRequest {
//!     root: "/tmp/bc-downloads".into(),
//!     source: DownloadSource::at("/tmp/staging/7f1c9ab2"),
//!     suggested_filename: "7f1c9ab2".into(),
//!     ..SaveRequest::default()
//! })?;
//! // A bare UUID carrying PDF bytes lands under a name a person can open.
//! assert!(saved.path.ends_with("7f1c9ab2.pdf"));
//! # Ok::<(), browser_commander::downloads::DownloadError>(())
//! ```

use std::fmt;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::downloads::destination::{restrict, ARTIFACT_DIRECTORY_MODE, ARTIFACT_FILE_MODE};
use crate::downloads::naming::{
    renamed_candidate, resolve_inside_root, sanitize_download_name, with_extension,
};
use crate::downloads::DownloadError;

/// How many bytes are kept to sniff a format from.
const MAGIC_BYTES: usize = 8;

/// Highest rename attempt before giving up rather than looping forever.
const MAX_RENAME_ATTEMPTS: usize = 1000;

/// How much of the file is copied at a time.
const COPY_CHUNK: usize = 64 * 1024;

/// How a name that is already taken is resolved.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DownloadConflict {
    /// Save alongside the existing file as `report (2).pdf`.
    #[default]
    Rename,
    /// Replace the existing file.
    Overwrite,
    /// Refuse to save rather than touch the existing file.
    Error,
}

impl DownloadConflict {
    /// The name this policy is known by in every language the library ships in.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Rename => "rename",
            Self::Overwrite => "overwrite",
            Self::Error => "error",
        }
    }
}

impl fmt::Display for DownloadConflict {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Where the engine left the bytes of a finished download.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DownloadSource {
    /// File the engine wrote.
    pub path: PathBuf,
    /// Whether the engine's copy is ours to delete once it has been placed.
    pub remove_source: bool,
}

impl DownloadSource {
    /// A source the engine still owns.
    pub fn at(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            remove_source: false,
        }
    }

    /// A source in our own staging directory, which is removed after placement.
    pub fn staged(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            remove_source: true,
        }
    }
}

/// What a download was saved as.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedDownload {
    /// Final path, inside the managed directory.
    pub path: PathBuf,
    /// Size in bytes.
    pub bytes: u64,
    /// Hex-encoded SHA-256 of the saved bytes.
    pub checksum: String,
}

/// What a naming callback is told about the download it is naming.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadNaming {
    /// Name the page suggested.
    pub suggested_filename: String,
    /// MIME type declared by the server, when there is one.
    pub mime_type: Option<String>,
}

/// What a validator is shown before the file is published.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DownloadCandidate {
    /// The partial file, which no caller can pick up under this name.
    pub path: PathBuf,
    /// Size in bytes.
    pub bytes: u64,
    /// Hex-encoded SHA-256 of the bytes.
    pub checksum: String,
    /// MIME type declared by the server, when there is one.
    pub mime_type: Option<String>,
    /// Name the page suggested.
    pub suggested_filename: String,
}

/// Names one download, overriding what the page suggested.
pub type DownloadNamer = Arc<dyn Fn(&DownloadNaming) -> String + Send + Sync>;

/// Decides whether a download may be published.
///
/// `Ok(true)` accepts, `Ok(false)` rejects, and an error rejects with the
/// validator's own message.
pub type DownloadValidator =
    Arc<dyn Fn(&DownloadCandidate) -> Result<bool, anyhow::Error> + Send + Sync>;

/// Everything [`save_download`] needs to place one download.
#[derive(Clone, Default)]
pub struct SaveRequest {
    /// Managed download directory.
    pub root: PathBuf,
    /// Where the engine left the bytes.
    pub source: DownloadSource,
    /// Name the page suggested.
    pub suggested_filename: String,
    /// MIME type declared by the server, when there is one.
    pub mime_type: Option<String>,
    /// How a name that is already taken is resolved.
    pub conflict: DownloadConflict,
    /// Caller naming callback.
    pub filename: Option<DownloadNamer>,
    /// Validation run before the file is published.
    pub validate: Option<DownloadValidator>,
}

impl fmt::Debug for SaveRequest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SaveRequest")
            .field("root", &self.root)
            .field("source", &self.source)
            .field("suggested_filename", &self.suggested_filename)
            .field("mime_type", &self.mime_type)
            .field("conflict", &self.conflict)
            .field("filename", &self.filename.is_some())
            .field("validate", &self.validate.is_some())
            .finish()
    }
}

/// What a copy into the staging file produced.
struct WrittenBytes {
    bytes: u64,
    checksum: String,
    head: Vec<u8>,
}

/// Copy the download into a partial file, hashing it on the way through.
///
/// Hashing during the copy means the bytes are read once: reading the file a
/// second time to checksum it would double the I/O and leave a window where the
/// file could change between the two reads.
fn copy_to_partial(source: &Path, partial_path: &Path) -> Result<WrittenBytes, DownloadError> {
    let io = |path: &Path| {
        let path = path.to_path_buf();
        move |source: std::io::Error| DownloadError::Io {
            path: path.clone(),
            source,
        }
    };

    let mut reader = File::open(source).map_err(io(source))?;
    let mut writer = File::create(partial_path).map_err(io(partial_path))?;
    let _ = restrict(partial_path, ARTIFACT_FILE_MODE);

    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; COPY_CHUNK];
    let mut bytes = 0_u64;
    let mut head = Vec::with_capacity(MAGIC_BYTES);

    loop {
        let read = reader.read(&mut buffer).map_err(io(source))?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        hasher.update(chunk);
        bytes += read as u64;
        if head.len() < MAGIC_BYTES {
            head.extend_from_slice(&chunk[..read.min(MAGIC_BYTES - head.len())]);
        }
        writer.write_all(chunk).map_err(io(partial_path))?;
    }
    writer.flush().map_err(io(partial_path))?;

    Ok(WrittenBytes {
        bytes,
        checksum: hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        head,
    })
}

/// Choose the final path for a completed download.
///
/// # Arguments
///
/// * `root` - Managed download directory
/// * `name` - Sanitized file name
/// * `conflict` - How a name that is already taken is resolved
///
/// # Returns
///
/// The absolute path the bytes may be published under.
///
/// # Errors
///
/// Returns [`DownloadError::NameTaken`] when the name exists and the policy is
/// [`DownloadConflict::Error`], or [`DownloadError::NoFreeName`] when renaming
/// ran out of attempts.
pub fn resolve_final_path(
    root: &Path,
    name: &str,
    conflict: DownloadConflict,
) -> Result<PathBuf, DownloadError> {
    if conflict == DownloadConflict::Overwrite {
        return resolve_inside_root(root, name);
    }

    for attempt in 0..MAX_RENAME_ATTEMPTS {
        let candidate = resolve_inside_root(root, &renamed_candidate(name, attempt))?;
        if !candidate.exists() {
            return Ok(candidate);
        }
        if conflict == DownloadConflict::Error {
            return Err(DownloadError::NameTaken { path: candidate });
        }
    }

    Err(DownloadError::NoFreeName {
        name: name.to_string(),
        attempts: MAX_RENAME_ATTEMPTS,
    })
}

/// Build the name of the partial file this save writes into.
fn partial_name(safe_name: &str) -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or_default();
    format!("{safe_name}.{}.{stamp}.partial", std::process::id())
}

/// Save a download into the managed directory.
///
/// # Arguments
///
/// * `request` - Everything about this download and how to place it
///
/// # Returns
///
/// Where the bytes ended up, how many there were, and their checksum.
///
/// # Errors
///
/// Returns a [`DownloadError`] when the bytes cannot be copied, the caller's
/// validation rejects them, or no name is available under the conflict policy.
/// In every one of those cases the partial file is removed, so a failed
/// download never leaves anything behind.
pub fn save_download(request: SaveRequest) -> Result<SavedDownload, DownloadError> {
    let root = request.root.as_path();
    std::fs::create_dir_all(root).map_err(|source| DownloadError::DirectoryNotCreated {
        root: root.to_path_buf(),
        source,
    })?;
    let _ = restrict(root, ARTIFACT_DIRECTORY_MODE);

    // A caller callback runs *before* sanitization, never instead of it: it is
    // a naming preference, not a grant of write access outside the root.
    let chosen = match &request.filename {
        Some(namer) => namer(&DownloadNaming {
            suggested_filename: request.suggested_filename.clone(),
            mime_type: request.mime_type.clone(),
        }),
        None => request.suggested_filename.clone(),
    };
    let safe_name = sanitize_download_name(&chosen);
    let partial_path = resolve_inside_root(root, &partial_name(&safe_name))?;

    let placed = place(&request, &safe_name, &partial_path);
    if placed.is_err() {
        let _ = std::fs::remove_file(&partial_path);
    }
    if request.source.remove_source {
        let _ = std::fs::remove_file(&request.source.path);
    }
    placed
}

/// Copy, validate and publish one download.
///
/// Split out so that [`save_download`] has exactly one place where a failed
/// download's partial file is removed.
fn place(
    request: &SaveRequest,
    safe_name: &str,
    partial_path: &Path,
) -> Result<SavedDownload, DownloadError> {
    let written = copy_to_partial(&request.source.path, partial_path)?;

    if let Some(validate) = &request.validate {
        // Validation sees the partial file, so a rejected download never
        // exists under the name a caller would pick it up by.
        let verdict = validate(&DownloadCandidate {
            path: partial_path.to_path_buf(),
            bytes: written.bytes,
            checksum: written.checksum.clone(),
            mime_type: request.mime_type.clone(),
            suggested_filename: request.suggested_filename.clone(),
        });
        match verdict {
            Ok(true) => {}
            Ok(false) => {
                return Err(DownloadError::Rejected {
                    name: safe_name.to_string(),
                })
            }
            Err(error) => {
                return Err(DownloadError::ValidationFailed {
                    name: safe_name.to_string(),
                    reason: error.to_string(),
                })
            }
        }
    }

    let final_name = with_extension(safe_name, request.mime_type.as_deref(), &written.head);
    let final_path = resolve_final_path(&request.root, &final_name, request.conflict)?;

    // Rename rather than copy: within one filesystem it is atomic, so a reader
    // watching the directory never sees a half-written file under this name.
    std::fs::rename(partial_path, &final_path).map_err(|source| DownloadError::Io {
        path: final_path.clone(),
        source,
    })?;
    let _ = restrict(&final_path, ARTIFACT_FILE_MODE);

    Ok(SavedDownload {
        path: final_path,
        bytes: written.bytes,
        checksum: written.checksum,
    })
}

/// Remove every partial file left behind in a download directory.
///
/// # Arguments
///
/// * `root` - Managed download directory
///
/// # Returns
///
/// The paths that were removed.
pub fn clean_partials(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };

    let mut removed: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|suffix| suffix == "partial"))
        .filter(|path| std::fs::remove_file(path).is_ok())
        .collect();
    removed.sort();
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::downloads::test_support::TempDir;

    /// A staged file holding `contents`, as an engine would have left it.
    fn staged(temp: &TempDir, name: &str, contents: &[u8]) -> DownloadSource {
        let path = temp.path().join(name);
        std::fs::write(&path, contents).unwrap();
        DownloadSource::at(path)
    }

    /// A request that saves `source` into `root` under `suggested`.
    fn request(root: &Path, source: DownloadSource, suggested: &str) -> SaveRequest {
        SaveRequest {
            root: root.to_path_buf(),
            source,
            suggested_filename: suggested.to_string(),
            ..SaveRequest::default()
        }
    }

    #[test]
    fn saves_a_download_under_its_suggested_name() {
        let temp = TempDir::new("bc-store");
        let root = temp.path().join("downloads");
        let source = staged(&temp, "engine-file", b"hello");

        let saved = save_download(request(&root, source, "notes.txt")).unwrap();

        assert_eq!(saved.path, root.join("notes.txt"));
        assert_eq!(saved.bytes, 5);
        assert_eq!(std::fs::read(&saved.path).unwrap(), b"hello");
        // The checksum is over the saved bytes, so a caller can prove the file
        // is the one the browser downloaded.
        assert_eq!(
            saved.checksum,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn names_a_bare_uuid_from_its_contents() {
        let temp = TempDir::new("bc-store-uuid");
        let root = temp.path().join("downloads");
        let source = staged(&temp, "staged", b"%PDF-1.7\nbody");

        let saved = save_download(request(&root, source, "7f1c9ab2-4ee1-4d62")).unwrap();

        assert_eq!(saved.path, root.join("7f1c9ab2-4ee1-4d62.pdf"));
    }

    #[test]
    fn lets_a_caller_choose_the_name_and_keeps_it_inside_the_root() {
        let temp = TempDir::new("bc-store-named");
        let root = temp.path().join("downloads");
        let source = staged(&temp, "staged", b"%PDF-1.7");

        let saved = save_download(SaveRequest {
            filename: Some(Arc::new(|_naming| "../../escaped.pdf".to_string())),
            ..request(&root, source, "7f1c9ab2")
        })
        .unwrap();

        // The caller picked the name; the module picked the directory.
        assert_eq!(saved.path, root.join("escaped.pdf"));
    }

    #[test]
    fn renames_rather_than_replacing_an_existing_file() {
        let temp = TempDir::new("bc-store-conflict");
        let root = temp.path().join("downloads");

        let first =
            save_download(request(&root, staged(&temp, "a", b"first"), "report.pdf")).unwrap();
        let second =
            save_download(request(&root, staged(&temp, "b", b"second"), "report.pdf")).unwrap();

        assert_eq!(first.path, root.join("report.pdf"));
        assert_eq!(second.path, root.join("report (2).pdf"));
        assert_eq!(std::fs::read(&first.path).unwrap(), b"first");
    }

    #[test]
    fn replaces_an_existing_file_when_the_caller_asked_for_that() {
        let temp = TempDir::new("bc-store-overwrite");
        let root = temp.path().join("downloads");

        save_download(request(&root, staged(&temp, "a", b"first"), "report.pdf")).unwrap();
        let second = save_download(SaveRequest {
            conflict: DownloadConflict::Overwrite,
            ..request(&root, staged(&temp, "b", b"second"), "report.pdf")
        })
        .unwrap();

        assert_eq!(second.path, root.join("report.pdf"));
        assert_eq!(std::fs::read(&second.path).unwrap(), b"second");
    }

    #[test]
    fn refuses_to_touch_an_existing_file_under_the_error_policy() {
        let temp = TempDir::new("bc-store-error");
        let root = temp.path().join("downloads");

        save_download(request(&root, staged(&temp, "a", b"first"), "report.pdf")).unwrap();
        let error = save_download(SaveRequest {
            conflict: DownloadConflict::Error,
            ..request(&root, staged(&temp, "b", b"second"), "report.pdf")
        })
        .unwrap_err();

        assert!(
            error.to_string().contains("downloads.conflict is 'error'"),
            "unexpected message: {error}"
        );
        assert_eq!(std::fs::read(root.join("report.pdf")).unwrap(), b"first");
        assert!(
            clean_partials(&root).is_empty(),
            "a partial was left behind"
        );
    }

    #[test]
    fn leaves_nothing_behind_when_validation_rejects_a_download() {
        let temp = TempDir::new("bc-store-reject");
        let root = temp.path().join("downloads");

        let error = save_download(SaveRequest {
            validate: Some(Arc::new(|candidate: &DownloadCandidate| {
                // The validator sees the bytes before anybody else can.
                Ok(std::fs::read(&candidate.path)?.starts_with(b"%PDF"))
            })),
            ..request(&root, staged(&temp, "a", b"<html>not a pdf"), "report.pdf")
        })
        .unwrap_err();

        assert!(
            error.to_string().contains("rejected by the caller"),
            "unexpected message: {error}"
        );
        assert!(!root.join("report.pdf").exists());
        let leftovers: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert!(leftovers.is_empty(), "left behind {leftovers:?}");
    }

    #[test]
    fn reports_a_validator_that_failed_rather_than_rejected() {
        let temp = TempDir::new("bc-store-validator-error");
        let root = temp.path().join("downloads");

        let error = save_download(SaveRequest {
            validate: Some(Arc::new(|_candidate| {
                Err(anyhow::anyhow!("the schema service was unreachable"))
            })),
            ..request(&root, staged(&temp, "a", b"body"), "report.pdf")
        })
        .unwrap_err();

        assert!(
            error
                .to_string()
                .contains("the schema service was unreachable"),
            "unexpected message: {error}"
        );
    }

    #[test]
    fn removes_a_staged_file_once_it_has_been_placed() {
        let temp = TempDir::new("bc-store-staged");
        let root = temp.path().join("downloads");
        let staging = temp.path().join("guid-1234");
        std::fs::write(&staging, b"body").unwrap();

        let saved = save_download(SaveRequest {
            source: DownloadSource::staged(&staging),
            ..request(&root, DownloadSource::default(), "report.txt")
        })
        .unwrap();

        assert!(saved.path.exists());
        assert!(!staging.exists(), "the staged copy outlived the download");
    }

    #[test]
    fn reports_a_download_whose_bytes_are_gone() {
        let temp = TempDir::new("bc-store-missing");
        let root = temp.path().join("downloads");

        let error = save_download(request(
            &root,
            DownloadSource::at(temp.path().join("never-written")),
            "report.pdf",
        ))
        .unwrap_err();

        assert!(
            error.to_string().contains("never-written"),
            "unexpected message: {error}"
        );
    }

    #[test]
    fn sweeps_up_partials_left_by_an_interrupted_run() {
        let temp = TempDir::new("bc-store-partials");
        let root = temp.path().join("downloads");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("report.pdf.17.999.partial"), b"half").unwrap();
        std::fs::write(root.join("report.pdf"), b"whole").unwrap();

        let removed = clean_partials(&root);

        assert_eq!(removed, vec![root.join("report.pdf.17.999.partial")]);
        // A completed download is a user's file, and sweeping is not a reason
        // to remove one.
        assert!(root.join("report.pdf").exists());
    }
}
