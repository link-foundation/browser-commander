//! Owner-only cookie and derived-key cache with cross-process locking.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

const DEFAULT_TTL_MINUTES: f64 = 60.0;
const LOCK_STALE_SECONDS: f64 = 30.0;
const LOCK_WAIT_SECONDS: f64 = 30.0;

static CREDENTIAL_MEMORY_CACHE: OnceLock<Mutex<HashMap<String, CachedCredential>>> =
    OnceLock::new();

#[derive(Debug, Clone)]
struct CachedCredential {
    key: Vec<u8>,
    saved_at: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct NormalizedCookieCache {
    pub enabled: bool,
    pub directory: PathBuf,
    pub ttl_seconds: f64,
}

pub(crate) fn normalize_cookie_cache(
    enabled: bool,
    directory: Option<&Path>,
    home_dir: &Path,
    ttl_minutes: Option<f64>,
) -> Result<NormalizedCookieCache> {
    let ttl_minutes = ttl_minutes.unwrap_or(DEFAULT_TTL_MINUTES);
    if !ttl_minutes.is_finite() || ttl_minutes < 0.0 {
        return Err(anyhow!(
            "cookie cache ttl_minutes must be a non-negative number"
        ));
    }
    Ok(NormalizedCookieCache {
        enabled,
        directory: directory
            .map(Path::to_path_buf)
            .unwrap_or_else(|| home_dir.join(".browser-commander/cookie-cache")),
        ttl_seconds: ttl_minutes * 60.0,
    })
}

fn memory_cache() -> &'static Mutex<HashMap<String, CachedCredential>> {
    CREDENTIAL_MEMORY_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Clear only the current process's derived-key cache.
pub fn clear_browser_cookie_memory_cache() {
    if let Ok(mut cache) = memory_cache().lock() {
        cache.clear();
    }
}

fn now_seconds() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs_f64())
        .unwrap_or_default()
}

fn hash(identity: &str) -> String {
    Sha256::digest(identity.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn cache_path(cache: &NormalizedCookieCache, kind: &str, identity: &str) -> PathBuf {
    cache
        .directory
        .join(format!("{kind}-{}.json", hash(identity)))
}

fn ensure_cache_directory(directory: &Path) -> Result<()> {
    fs::create_dir_all(directory)
        .with_context(|| format!("Could not create cookie cache {}", directory.display()))?;
    restrict_owner_only(directory, true)?;
    Ok(())
}

#[cfg(unix)]
fn restrict_owner_only(path: &Path, directory: bool) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let mode = if directory { 0o700 } else { 0o600 };
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
        .with_context(|| format!("Could not protect cookie cache {}", path.display()))
}

#[cfg(windows)]
fn restrict_owner_only(path: &Path, directory: bool) -> Result<()> {
    use std::process::Command;

    let whoami = Command::new("whoami")
        .output()
        .context("Could not identify the current Windows user")?;
    if !whoami.status.success() {
        return Err(anyhow!("Could not identify the current Windows user"));
    }
    let principal = String::from_utf8(whoami.stdout)
        .context("Windows user identity was not valid UTF-8")?
        .trim()
        .to_owned();
    if principal.is_empty() {
        return Err(anyhow!("Could not identify the current Windows user"));
    }
    let permission = if directory { "(OI)(CI)F" } else { "F" };
    let status = Command::new("icacls")
        .arg(path)
        .args(["/inheritance:r", "/grant:r"])
        .arg(format!("{principal}:{permission}"))
        .arg("/q")
        .status()
        .with_context(|| format!("Could not protect cookie cache {}", path.display()))?;
    if !status.success() {
        return Err(anyhow!(
            "Could not protect cookie cache {} with a Windows ACL",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(all(not(unix), not(windows)))]
fn restrict_owner_only(_path: &Path, _directory: bool) -> Result<()> {
    Err(anyhow!(
        "owner-only cookie caching is unsupported on this platform"
    ))
}

fn read_fresh_json(path: &Path, ttl_seconds: f64) -> Option<Value> {
    let value = serde_json::from_str::<Value>(&fs::read_to_string(path).ok()?).ok()?;
    let saved_at = value.get("savedAt")?.as_f64()?;
    let age = now_seconds() - saved_at;
    (age >= 0.0 && age <= ttl_seconds).then_some(value)
}

fn temporary_path(path: &Path) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    path.with_file_name(format!(
        "{}.{}.{unique}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("cache"),
        std::process::id()
    ))
}

fn owner_only_file(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
        .open(path)
        .with_context(|| format!("Could not create owner-only cache file {}", path.display()))
}

fn write_owner_only_json(path: &Path, value: &Value) -> Result<()> {
    let temporary = temporary_path(path);
    let mut file = owner_only_file(&temporary)?;
    let result = (|| -> Result<()> {
        serde_json::to_writer(&mut file, value)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
        drop(file);
        #[cfg(windows)]
        if path.exists() {
            fs::remove_file(path)?;
        }
        fs::rename(&temporary, path)?;
        restrict_owner_only(path, false)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.with_context(|| format!("Could not write cookie cache {}", path.display()))
}

pub(crate) fn read_cookie_result_cache(
    cache: &NormalizedCookieCache,
    identity: &str,
    refresh: bool,
) -> Option<Vec<Value>> {
    if !cache.enabled || refresh {
        return None;
    }
    let value = read_fresh_json(&cache_path(cache, "cookies", identity), cache.ttl_seconds)?;
    if value.get("kind").and_then(Value::as_str) != Some("cookies") {
        return None;
    }
    value.get("cookies")?.as_array().cloned()
}

pub(crate) fn write_cookie_result_cache(
    cache: &NormalizedCookieCache,
    identity: &str,
    cookies: &[Value],
) -> Result<()> {
    if !cache.enabled {
        return Ok(());
    }
    ensure_cache_directory(&cache.directory)?;
    write_owner_only_json(
        &cache_path(cache, "cookies", identity),
        &json!({
            "version": 1,
            "kind": "cookies",
            "savedAt": now_seconds(),
            "cookies": cookies,
        }),
    )
}

enum LockResult {
    Acquired(File),
    Cached(Value),
}

fn remove_stale_lock(lock_path: &Path) {
    let stale = fs::metadata(lock_path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age.as_secs_f64() > LOCK_STALE_SECONDS);
    if stale {
        let _ = fs::remove_file(lock_path);
    }
}

fn acquire_lock_or_cached(
    lock_path: &Path,
    cached_path: &Path,
    ttl_seconds: f64,
    refresh: bool,
    initial_saved_at: Option<f64>,
) -> Result<LockResult> {
    let started = Instant::now();
    while started.elapsed().as_secs_f64() <= LOCK_WAIT_SECONDS {
        match owner_only_file(lock_path) {
            Ok(file) => return Ok(LockResult::Acquired(file)),
            Err(error)
                if error
                    .downcast_ref::<std::io::Error>()
                    .is_some_and(|error| error.kind() == ErrorKind::AlreadyExists) =>
            {
                if let Some(value) = read_fresh_json(cached_path, ttl_seconds) {
                    let saved_at = value.get("savedAt").and_then(Value::as_f64);
                    if value.get("kind").and_then(Value::as_str) == Some("derived-key")
                        && (!refresh || saved_at != initial_saved_at)
                    {
                        return Ok(LockResult::Cached(value));
                    }
                }
                remove_stale_lock(lock_path);
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => return Err(error),
        }
    }
    Err(anyhow!(
        "timed out waiting for another cookie credential reader"
    ))
}

fn decode_cached_credential(value: &Value) -> Result<CachedCredential> {
    let key = BASE64
        .decode(
            value
                .get("key")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow!("derived-key cache has no key"))?,
        )
        .context("derived-key cache contains invalid base64")?;
    let saved_at = value
        .get("savedAt")
        .and_then(Value::as_f64)
        .ok_or_else(|| anyhow!("derived-key cache has no savedAt timestamp"))?;
    Ok(CachedCredential { key, saved_at })
}

pub(crate) fn get_cached_credential<F>(
    cache: &NormalizedCookieCache,
    identity: &str,
    refresh: bool,
    metadata: Map<String, Value>,
    create: F,
) -> Result<Vec<u8>>
where
    F: FnOnce() -> Result<Vec<u8>>,
{
    let memory_identity = format!("{}:{identity}", cache.directory.display());
    if !refresh {
        let mut memory = memory_cache()
            .lock()
            .map_err(|_| anyhow!("cookie credential memory cache is poisoned"))?;
        if let Some(cached) = memory.get(&memory_identity) {
            let age = now_seconds() - cached.saved_at;
            if age >= 0.0 && age <= cache.ttl_seconds {
                return Ok(cached.key.clone());
            }
        }
        memory.remove(&memory_identity);
    }
    let credential = load_or_create_credential(cache, identity, refresh, metadata, create)?;
    memory_cache()
        .lock()
        .map_err(|_| anyhow!("cookie credential memory cache is poisoned"))?
        .insert(memory_identity, credential.clone());
    Ok(credential.key)
}

fn load_or_create_credential<F>(
    cache: &NormalizedCookieCache,
    identity: &str,
    refresh: bool,
    metadata: Map<String, Value>,
    create: F,
) -> Result<CachedCredential>
where
    F: FnOnce() -> Result<Vec<u8>>,
{
    if !cache.enabled {
        return Ok(CachedCredential {
            key: create()?,
            saved_at: now_seconds(),
        });
    }
    ensure_cache_directory(&cache.directory)?;
    let cached_path = cache_path(cache, "credential", identity);
    let lock_path = PathBuf::from(format!("{}.lock", cached_path.display()));
    let initial = read_fresh_json(&cached_path, cache.ttl_seconds);
    if !refresh {
        if let Some(value) = initial
            .as_ref()
            .filter(|value| value.get("kind").and_then(Value::as_str) == Some("derived-key"))
        {
            return decode_cached_credential(value);
        }
    }
    let initial_saved_at = initial
        .as_ref()
        .and_then(|value| value.get("savedAt"))
        .and_then(Value::as_f64);
    match acquire_lock_or_cached(
        &lock_path,
        &cached_path,
        cache.ttl_seconds,
        refresh,
        initial_saved_at,
    )? {
        LockResult::Cached(value) => decode_cached_credential(&value),
        LockResult::Acquired(lock) => {
            drop(lock);
            let result = (|| -> Result<CachedCredential> {
                if let Some(value) = read_fresh_json(&cached_path, cache.ttl_seconds) {
                    let saved_at = value.get("savedAt").and_then(Value::as_f64);
                    if value.get("kind").and_then(Value::as_str) == Some("derived-key")
                        && (!refresh || saved_at != initial_saved_at)
                    {
                        return decode_cached_credential(&value);
                    }
                }
                let key = create()?;
                let saved_at = now_seconds();
                let mut value = metadata;
                value.insert("version".into(), json!(1));
                value.insert("kind".into(), json!("derived-key"));
                value.insert("savedAt".into(), json!(saved_at));
                value.insert("key".into(), json!(BASE64.encode(&key)));
                write_owner_only_json(&cached_path, &Value::Object(value))?;
                Ok(CachedCredential { key, saved_at })
            })();
            let _ = fs::remove_file(lock_path);
            result
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_cache_is_owner_only_and_reused_after_memory_reset() -> Result<()> {
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;

        let directory = std::env::temp_dir().join(format!(
            "browser-commander-cache-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        let cache = NormalizedCookieCache {
            enabled: true,
            directory: directory.clone(),
            ttl_seconds: 60.0,
        };
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let create = || {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(vec![7_u8; 16])
        };
        let metadata = Map::new();
        get_cached_credential(
            &cache,
            "chrome:linux:safe-storage",
            false,
            metadata.clone(),
            create,
        )?;
        clear_browser_cookie_memory_cache();
        get_cached_credential(&cache, "chrome:linux:safe-storage", false, metadata, create)?;
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        let cached = fs::read_dir(&directory)?
            .flatten()
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("credential-")
            })
            .unwrap();
        #[cfg(unix)]
        assert_eq!(cached.metadata()?.permissions().mode() & 0o777, 0o600);
        #[cfg(windows)]
        {
            use std::process::Command;

            let acl = Command::new("icacls").arg(cached.path()).output()?;
            let principal = Command::new("whoami").output()?;
            let acl = String::from_utf8(acl.stdout)?.to_lowercase();
            let principal = String::from_utf8(principal.stdout)?.trim().to_lowercase();
            assert!(acl.contains(&principal));
            assert!(!acl.contains("(i)"));
        }
        fs::remove_dir_all(directory)?;
        Ok(())
    }

    #[test]
    fn in_process_credential_cache_expires_after_ttl() -> Result<()> {
        let directory = std::env::temp_dir().join(format!(
            "browser-commander-memory-ttl-test-{}",
            std::process::id()
        ));
        let cache = NormalizedCookieCache {
            enabled: false,
            directory,
            ttl_seconds: 0.0,
        };
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let create = || {
            let call = calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
            Ok(vec![call as u8; 16])
        };

        clear_browser_cookie_memory_cache();
        assert_eq!(
            get_cached_credential(&cache, "chrome:linux:ttl-test", false, Map::new(), create)?[0],
            1
        );
        thread::sleep(Duration::from_millis(5));
        assert_eq!(
            get_cached_credential(&cache, "chrome:linux:ttl-test", false, Map::new(), create)?[0],
            2
        );
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        Ok(())
    }
}
