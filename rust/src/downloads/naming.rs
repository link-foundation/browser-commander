//! Naming and placement rules for managed downloads (issue #88).
//!
//! Everything here answers one question: given a name a *page* chose, where is
//! it safe to write the bytes? A suggested filename is attacker-controlled
//! input, so it is treated as a hint and never as a path.
//!
//! # Example
//!
//! ```rust
//! use browser_commander::downloads::{sanitize_download_name, with_extension};
//!
//! // A page cannot pick the directory, only the name.
//! assert_eq!(sanitize_download_name("../../etc/passwd"), "passwd");
//!
//! // A bare UUID becomes openable once the bytes say what it is.
//! assert_eq!(
//!     with_extension("7f1c9ab2", None, b"%PDF-1.7"),
//!     "7f1c9ab2.pdf"
//! );
//! ```

use std::path::{Component, Path, PathBuf};

use crate::downloads::DownloadError;

/// The type a server sends when it cannot name the format either.
const GENERIC_BINARY_TYPE: &str = "application/octet-stream";

/// Extensions derived from a declared or detected MIME type.
const MIME_EXTENSIONS: &[(&str, &str)] = &[
    ("application/pdf", ".pdf"),
    ("application/json", ".json"),
    ("application/zip", ".zip"),
    ("application/gzip", ".gz"),
    ("application/x-tar", ".tar"),
    (GENERIC_BINARY_TYPE, ".bin"),
    ("application/vnd.ms-excel", ".xls"),
    (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".xlsx",
    ),
    ("application/msword", ".doc"),
    (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".docx",
    ),
    ("text/csv", ".csv"),
    ("text/html", ".html"),
    ("text/plain", ".txt"),
    ("image/png", ".png"),
    ("image/jpeg", ".jpg"),
    ("image/gif", ".gif"),
    ("image/svg+xml", ".svg"),
    ("image/webp", ".webp"),
    ("video/mp4", ".mp4"),
    ("audio/mpeg", ".mp3"),
];

/// Leading bytes that identify a format regardless of what the page claimed.
const MAGIC_NUMBERS: &[(&str, &[u8])] = &[
    (".pdf", b"\x25\x50\x44\x46"),
    (".png", b"\x89\x50\x4e\x47"),
    (".gif", b"\x47\x49\x46\x38"),
    (".jpg", b"\xff\xd8\xff"),
    (".zip", b"\x50\x4b\x03\x04"),
    (".gz", b"\x1f\x8b"),
];

/// Name used when a page suggests nothing usable at all.
const FALLBACK_NAME: &str = "download";

/// Characters a filename may not contain on every system this runs on.
const REPLACED_CHARACTERS: &[char] = &[':', '*', '?', '"', '<', '>', '|'];

/// Windows device names that cannot be used as files even on other systems.
fn is_reserved_name(stem: &str) -> bool {
    let lowered = stem.to_ascii_lowercase();
    if matches!(lowered.as_str(), "con" | "prn" | "aux" | "nul") {
        return true;
    }

    for prefix in ["com", "lpt"] {
        if let Some(digit) = lowered.strip_prefix(prefix) {
            if matches!(digit, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9") {
                return true;
            }
        }
    }
    false
}

/// Strip a page-supplied name down to something that can only ever be a file
/// inside the download root.
///
/// Path separators, drive letters, control characters and `..` segments are
/// removed rather than rejected, because a rejected download is a lost download
/// and the caller asked for the file, not for the page's spelling of it.
///
/// # Arguments
///
/// * `suggested` - Name suggested by the page or engine
///
/// # Returns
///
/// A single safe path segment.
pub fn sanitize_download_name(suggested: &str) -> String {
    // Take the last segment under both separators: a page may suggest
    // `../../etc/passwd` or `C:\Windows\system32\x`, and neither is a location
    // we are willing to honor.
    let last_segment = suggested
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_string();

    let cleaned: String = last_segment
        .chars()
        .filter(|character| !character.is_control())
        .map(|character| {
            if REPLACED_CHARACTERS.contains(&character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    let cleaned = cleaned
        .trim_start()
        .trim_end_matches(|character: char| character.is_whitespace() || character == '.')
        .trim()
        .to_string();

    if cleaned.is_empty() {
        return FALLBACK_NAME.to_string();
    }

    let stem = match cleaned.rfind('.') {
        Some(dot) => &cleaned[..dot],
        None => cleaned.as_str(),
    };
    if is_reserved_name(stem) {
        return format!("_{cleaned}");
    }

    cleaned
}

/// Guess an extension from the first bytes of the file.
///
/// # Arguments
///
/// * `head` - Leading bytes of the download
///
/// # Returns
///
/// Extension including the dot, or an empty string.
pub fn extension_from_content(head: &[u8]) -> &'static str {
    if head.is_empty() {
        return "";
    }

    MAGIC_NUMBERS
        .iter()
        .find(|(_, bytes)| head.starts_with(bytes))
        .map_or("", |(extension, _)| *extension)
}

/// Look up the extension a declared MIME type implies.
fn extension_from_mime(declared: &str) -> &'static str {
    MIME_EXTENSIONS
        .iter()
        .find(|(mime, _)| *mime == declared)
        .map_or("", |(_, extension)| *extension)
}

/// Report whether a name already carries an extension.
fn has_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .is_some_and(|extension| !extension.is_empty())
}

/// Give a name an extension when the page did not supply one.
///
/// Pages hand out UUID-like names constantly; a file called `7f1c...-9ab2` is
/// unusable to a human and unopenable by the OS, so the declared MIME type (or
/// the bytes themselves) supplies the missing suffix.
///
/// # Arguments
///
/// * `name` - Sanitized name
/// * `mime_type` - MIME type declared by the server, when there is one
/// * `head` - Leading bytes of the file
///
/// # Returns
///
/// The name with an extension when one could be determined.
pub fn with_extension(name: &str, mime_type: Option<&str>, head: &[u8]) -> String {
    if has_extension(name) {
        return name.to_string();
    }

    let declared_type = mime_type
        .unwrap_or_default()
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let declared = extension_from_mime(&declared_type);
    let sniffed = extension_from_content(head);

    // `application/octet-stream` is what a server sends when it does not know
    // either, so the bytes outrank it; any other declared type is a real claim.
    let extension = if declared_type == GENERIC_BINARY_TYPE {
        if sniffed.is_empty() {
            declared
        } else {
            sniffed
        }
    } else if declared.is_empty() {
        sniffed
    } else {
        declared
    };

    format!("{name}{extension}")
}

/// Resolve `.` and `..` without touching the filesystem.
///
/// [`std::fs::canonicalize`] would need every component to exist, and the
/// download root is checked before anything has been written into it.
fn lexically_absolute(path: &Path) -> PathBuf {
    let anchored = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };

    let mut resolved = PathBuf::new();
    for component in anchored.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// Report whether a resolved path stays inside the download root.
///
/// The check is done on resolved paths rather than on the name, so a relative
/// root cannot be used to step outside it.
///
/// # Arguments
///
/// * `root` - Download directory
/// * `candidate` - Candidate path
///
/// # Returns
///
/// Whether the candidate is inside the root.
pub fn is_inside_root(root: &Path, candidate: &Path) -> bool {
    let root = lexically_absolute(root);
    let candidate = lexically_absolute(candidate);
    candidate != root && candidate.starts_with(&root)
}

/// Resolve a safe absolute path for a download inside the root.
///
/// # Arguments
///
/// * `root` - Download directory
/// * `name` - Sanitized file name
///
/// # Returns
///
/// An absolute path inside the root.
///
/// # Errors
///
/// Returns [`DownloadError::OutsideRoot`] when the name would escape the root.
pub fn resolve_inside_root(root: &Path, name: &str) -> Result<PathBuf, DownloadError> {
    let candidate = lexically_absolute(&root.join(name));
    if !is_inside_root(root, &candidate) {
        return Err(DownloadError::OutsideRoot {
            name: name.to_string(),
            root: lexically_absolute(root),
        });
    }
    Ok(candidate)
}

/// Produce the candidate names a rename-on-conflict policy tries, in order.
///
/// `report.pdf`, `report (2).pdf`, `report (3).pdf`, … — the order is fixed, so
/// two runs of the same scenario produce the same names.
///
/// # Arguments
///
/// * `name` - Sanitized file name
/// * `attempt` - Zero-based attempt number
///
/// # Returns
///
/// The candidate name for that attempt.
pub fn renamed_candidate(name: &str, attempt: usize) -> String {
    if attempt == 0 {
        return name.to_string();
    }

    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .filter(|extension| !extension.is_empty())
        .map(|extension| format!(".{extension}"))
        .unwrap_or_default();
    let stem = &name[..name.len() - extension.len()];
    format!("{stem} ({}){extension}", attempt + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_name_that_was_already_safe() {
        assert_eq!(sanitize_download_name("report.pdf"), "report.pdf");
    }

    #[test]
    fn takes_only_the_last_segment_of_a_path() {
        assert_eq!(sanitize_download_name("../../etc/passwd"), "passwd");
        assert_eq!(
            sanitize_download_name("C:\\Windows\\system32\\evil.exe"),
            "evil.exe"
        );
    }

    #[test]
    fn falls_back_when_a_page_suggests_nothing_usable() {
        assert_eq!(sanitize_download_name(""), "download");
        assert_eq!(sanitize_download_name(".."), "download");
        assert_eq!(sanitize_download_name("   "), "download");
    }

    #[test]
    fn removes_characters_a_filesystem_cannot_hold() {
        assert_eq!(sanitize_download_name("a:b*c?.txt"), "a_b_c_.txt");
        assert_eq!(sanitize_download_name("re\u{0}port.pdf"), "report.pdf");
    }

    #[test]
    fn steps_around_reserved_device_names() {
        assert_eq!(sanitize_download_name("CON.txt"), "_CON.txt");
        assert_eq!(sanitize_download_name("lpt9"), "_lpt9");
        assert_eq!(sanitize_download_name("console.txt"), "console.txt");
    }

    #[test]
    fn reads_a_format_out_of_the_first_bytes() {
        assert_eq!(extension_from_content(b"%PDF-1.7"), ".pdf");
        assert_eq!(extension_from_content(b"\x89PNG\r\n"), ".png");
        assert_eq!(extension_from_content(b"nothing familiar"), "");
        assert_eq!(extension_from_content(b""), "");
    }

    #[test]
    fn leaves_a_name_that_already_has_an_extension_alone() {
        assert_eq!(
            with_extension("report.pdf", Some("text/csv"), b"%PDF"),
            "report.pdf"
        );
    }

    #[test]
    fn names_a_bare_uuid_from_the_declared_type() {
        assert_eq!(
            with_extension("7f1c9ab2-4ee1", Some("application/pdf"), b""),
            "7f1c9ab2-4ee1.pdf"
        );
    }

    #[test]
    fn believes_the_bytes_over_a_generic_declaration() {
        // A server that says `application/octet-stream` has told us nothing,
        // so a `.pdf` header is the better evidence.
        assert_eq!(
            with_extension("blob", Some("application/octet-stream"), b"%PDF-1.4"),
            "blob.pdf"
        );
        assert_eq!(
            with_extension("blob", Some("application/octet-stream"), b"??"),
            "blob.bin"
        );
    }

    #[test]
    fn leaves_a_name_unchanged_when_nothing_identifies_it() {
        assert_eq!(with_extension("blob", None, b"???"), "blob");
    }

    #[test]
    fn keeps_a_candidate_inside_the_root() {
        let root = Path::new("/tmp/bc-downloads");
        assert!(is_inside_root(root, Path::new("/tmp/bc-downloads/a.pdf")));
        assert!(!is_inside_root(root, Path::new("/tmp/bc-downloads")));
        assert!(!is_inside_root(root, Path::new("/tmp/elsewhere/a.pdf")));
        assert!(!is_inside_root(
            root,
            Path::new("/tmp/bc-downloads/../escaped.pdf")
        ));
    }

    #[test]
    fn refuses_to_resolve_a_name_that_escapes_the_root() {
        // A real absolute root: `resolve_inside_root` anchors a relative root
        // to the working directory, and `/tmp/bc-downloads` is relative on
        // Windows, where a path with no drive letter is not absolute.
        let root = std::env::temp_dir().join("bc-downloads");
        let root = root.as_path();

        assert_eq!(
            resolve_inside_root(root, "a.pdf").unwrap(),
            root.join("a.pdf")
        );

        let error = resolve_inside_root(root, "../escaped.pdf").unwrap_err();
        assert!(
            error.to_string().contains(&format!(
                "outside the download directory {}",
                root.display()
            )),
            "unexpected message: {error}"
        );
    }

    #[test]
    fn numbers_conflicting_names_the_way_a_person_would() {
        assert_eq!(renamed_candidate("report.pdf", 0), "report.pdf");
        assert_eq!(renamed_candidate("report.pdf", 1), "report (2).pdf");
        assert_eq!(renamed_candidate("report.pdf", 2), "report (3).pdf");
        assert_eq!(renamed_candidate("report", 1), "report (2)");
        assert_eq!(renamed_candidate("archive.tar.gz", 1), "archive.tar (2).gz");
    }
}
