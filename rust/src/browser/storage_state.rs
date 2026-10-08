//! Playwright-compatible cookie and origin-scoped localStorage state.

use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::core::engine::EngineAdapter;

/// A name and value from an origin's localStorage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageEntry {
    /// Storage key.
    pub name: String,
    /// Storage value.
    pub value: String,
}

/// localStorage captured from one origin.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageOrigin {
    /// Scheme, hostname and port.
    pub origin: String,
    /// localStorage values for that origin.
    #[serde(rename = "localStorage")]
    pub local_storage: Vec<StorageEntry>,
}

/// Portable cookies and localStorage in Playwright's storage-state format.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StorageState {
    /// Cookies use the Playwright/CDP cookie shape.
    #[serde(default)]
    pub cookies: Vec<Value>,
    /// Origin-scoped localStorage.
    #[serde(default)]
    pub origins: Vec<StorageOrigin>,
}

/// A state object or a JSON file to read before browser startup.
#[derive(Clone, Debug)]
pub enum StorageStateInput {
    /// Read the state from a JSON file.
    Path(PathBuf),
    /// Use this state directly.
    Value(StorageState),
}

impl From<StorageState> for StorageStateInput {
    fn from(value: StorageState) -> Self {
        Self::Value(value)
    }
}

impl From<PathBuf> for StorageStateInput {
    fn from(value: PathBuf) -> Self {
        Self::Path(value)
    }
}

impl From<&Path> for StorageStateInput {
    fn from(value: &Path) -> Self {
        Self::Path(value.to_path_buf())
    }
}

impl StorageStateInput {
    /// Read and validate the state.
    pub fn load(&self) -> anyhow::Result<StorageState> {
        let state = match self {
            Self::Path(path) => {
                let contents = std::fs::read(path)
                    .with_context(|| format!("could not read storage state {}", path.display()))?;
                serde_json::from_slice(&contents)
                    .with_context(|| format!("invalid storage state {}", path.display()))?
            }
            Self::Value(state) => state.clone(),
        };
        validate_storage_state(&state)?;
        Ok(state)
    }
}

fn validate_storage_state(state: &StorageState) -> anyhow::Result<()> {
    if state.cookies.iter().any(|cookie| {
        cookie.get("name").and_then(Value::as_str).is_none()
            || cookie.get("value").and_then(Value::as_str).is_none()
    }) {
        return Err(anyhow!(
            "storage state cookies must have string names and values"
        ));
    }
    if state.origins.iter().any(|origin| origin.origin.is_empty()) {
        return Err(anyhow!("storage state origins must have nonempty URLs"));
    }
    Ok(())
}

/// A page script that restores localStorage only at its matching origin.
pub(crate) fn restore_script(state: &StorageState) -> anyhow::Result<String> {
    let origins = serde_json::to_string(&state.origins)?;
    Ok(format!(
        "(() => {{ const origins = {origins}; \
         const entry = origins.find(item => item.origin === globalThis.location.origin); \
         if (!entry) return; for (const item of entry.localStorage) \
         globalThis.localStorage.setItem(item.name, item.value); }})()"
    ))
}

/// Export the current browser's cookies and current page's localStorage.
pub async fn save_storage_state(
    page: &dyn EngineAdapter,
    file_path: Option<&Path>,
) -> anyhow::Result<StorageState> {
    let value = page.export_storage_state().await?;
    let state: StorageState = serde_json::from_value(value)?;
    validate_storage_state(&state)?;
    if let Some(path) = file_path {
        let mut encoded = serde_json::to_vec_pretty(&state)?;
        encoded.push(b'\n');
        write_restricted_bytes(path, &encoded)?;
    }
    Ok(state)
}

pub(crate) fn write_restricted_state(path: &Path, state: &StorageState) -> anyhow::Result<()> {
    write_restricted_bytes(path, &serde_json::to_vec_pretty(state)?)
}

fn write_restricted_bytes(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let temporary = path.with_file_name(format!(
        ".browser-commander-{}-{}.tmp",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let written = (|| {
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    let _ = std::fs::remove_file(&temporary);
    written.map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_portable_state_from_object_and_file() {
        let state = StorageState {
            cookies: vec![
                serde_json::json!({"name":"sid","value":"saved","domain":"example.test","path":"/"}),
            ],
            origins: vec![StorageOrigin {
                origin: "https://example.test".to_string(),
                local_storage: vec![StorageEntry {
                    name: "theme".to_string(),
                    value: "dark".to_string(),
                }],
            }],
        };
        let directory = std::env::temp_dir().join(format!(
            "browser-commander-storage-state-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("state.json");
        std::fs::write(&path, serde_json::to_vec(&state).unwrap()).unwrap();

        assert_eq!(
            StorageStateInput::Value(state.clone()).load().unwrap(),
            state
        );
        assert_eq!(StorageStateInput::Path(path).load().unwrap(), state);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
