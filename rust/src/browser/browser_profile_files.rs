//! Companion files differ for single-profile browsers such as Opera.

use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

/// Resolve existing ancestors when the target profile does not exist yet.
pub(crate) fn physical_path(path: &Path) -> Result<PathBuf> {
    let mut existing = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let mut suffix = Vec::new();
    loop {
        match existing.canonicalize() {
            Ok(mut resolved) => {
                for component in suffix.into_iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                suffix.push(
                    existing
                        .file_name()
                        .ok_or_else(|| anyhow!("Invalid profile path"))?
                        .to_os_string(),
                );
                existing.pop();
            }
            Err(error) => return Err(error.into()),
        }
    }
}

pub(crate) fn local_state_path_for_profile(profile_dir: &Path) -> PathBuf {
    let own = profile_dir.join("Local State");
    if own.exists() {
        own
    } else {
        profile_dir
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join("Local State")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_profile_local_state_precedes_parent() {
        let root = std::env::temp_dir().join(format!("bc-opera-{}", std::process::id()));
        let profile = root.join("Opera Stable");
        std::fs::create_dir_all(&profile).unwrap();
        std::fs::write(root.join("Local State"), "{}").unwrap();
        std::fs::write(profile.join("Local State"), "{}").unwrap();
        assert_eq!(
            local_state_path_for_profile(&profile),
            profile.join("Local State")
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
