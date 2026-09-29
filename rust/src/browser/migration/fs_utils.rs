//! Small filesystem helpers shared by the migration data-class modules,
//! mirroring `js/src/browser/migration/fs-utils.js`.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Result};
use serde_json::Value;

/// Return true when a path exists (of any type).
pub(crate) fn path_exists(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

/// Read and parse a JSON file, returning `None` when it is missing or malformed.
pub(crate) fn read_json_if_present(path: &Path) -> Option<Value> {
    let contents = fs::read_to_string(path).ok()?;
    serde_json::from_str(&contents).ok()
}

/// Resolve a file inside a profile directory, or `None` when it is absent.
pub(crate) fn profile_file_if_present(profile_dir: &Path, name: &str) -> Option<PathBuf> {
    let path = profile_dir.join(name);
    path_exists(&path).then_some(path)
}

/// Create a fresh directory in the system temporary directory whose name starts
/// with `prefix` (the `mkdtemp` equivalent).
pub(crate) fn make_temp_dir(prefix: &str) -> Result<PathBuf> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let parent = std::env::temp_dir();
    loop {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let count = COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!("{prefix}{}-{nanos:x}-{count}", std::process::id()));
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(anyhow!(error).context(format!(
                    "Could not create a temporary directory in {}",
                    parent.display()
                )))
            }
        }
    }
}

/// Remove a directory tree, ignoring a directory that is already gone.
pub(crate) fn remove_dir_quietly(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

/// Recursively copy a directory tree, overwriting existing files (the
/// `fs.cp(source, target, { recursive: true, force: true })` equivalent).
pub(crate) fn copy_dir_recursive(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target).map_err(|error| {
        anyhow!(error).context(format!("Could not create {}", target.display()))
    })?;
    for entry in fs::read_dir(source)
        .map_err(|error| anyhow!(error).context(format!("Could not read {}", source.display())))?
    {
        let entry = entry?;
        let destination = target.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&entry.path(), &destination)?;
        } else {
            fs::copy(entry.path(), &destination).map_err(|error| {
                anyhow!(error).context(format!("Could not copy {}", entry.path().display()))
            })?;
        }
    }
    Ok(())
}

/// JSON object entries in document order.
///
/// `serde_json` is built without `preserve_order`, so a parsed `Map` iterates
/// alphabetically. JavaScript's `Object.entries` keeps insertion order for
/// non-numeric keys (and a repeated key keeps its first position with the last
/// value), which this reproduces for the few places where the order is
/// observable in a migration report.
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct OrderedEntries(pub Vec<(String, Value)>);

impl<'de> serde::Deserialize<'de> for OrderedEntries {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct EntriesVisitor;

        impl<'de> serde::de::Visitor<'de> for EntriesVisitor {
            type Value = OrderedEntries;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut map: A,
            ) -> Result<Self::Value, A::Error> {
                let mut entries: Vec<(String, Value)> = Vec::new();
                while let Some((key, value)) = map.next_entry::<String, Value>()? {
                    match entries.iter_mut().find(|(existing, _)| *existing == key) {
                        Some(entry) => entry.1 = value,
                        None => entries.push((key, value)),
                    }
                }
                Ok(OrderedEntries(entries))
            }
        }

        deserializer.deserialize_map(EntriesVisitor)
    }
}
