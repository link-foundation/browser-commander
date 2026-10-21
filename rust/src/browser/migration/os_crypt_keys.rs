//! Resolve the OSCrypt keys a migration needs: the source profile's key (to
//! decrypt) and the target profile's key (to re-encrypt). Mirrors
//! `js/src/browser/migration/os-crypt-keys.js`.
//!
//! Both sides reuse the cookie key handling so passwords and cookies share one
//! implementation of the per-platform keystore. Every keystore call is
//! injectable through [`KeystoreHooks`] so the whole thing runs on Linux in
//! unit tests.
//!
//! On macOS and Linux the Safe Storage key is per application, not per
//! profile, so the target key is looked up for the launching browser channel.
//! On Windows the target key does not exist yet: the caller generates one with
//! `create_windows_profile_key` and writes it into the target `Local State`.

use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};

use crate::browser::browser_cookie_credentials::{
    read_safe_storage_password, read_windows_encryption_key,
};
use crate::browser::browser_cookie_crypto::derive_chromium_cookie_key;

/// Reads a Safe Storage password for `(browser, platform)`.
pub type SafeStoragePasswordReader = Arc<dyn Fn(&str, &str) -> Result<String> + Send + Sync>;
/// Reads and DPAPI-unwraps the key in a Windows `Local State` file.
pub type WindowsKeyReader = Arc<dyn Fn(&Path) -> Result<Vec<u8>> + Send + Sync>;

/// The OS keystore calls a migration makes. The defaults use the same
/// command-stream backed readers as `read_browser_cookies`.
#[derive(Clone)]
pub struct KeystoreHooks {
    /// macOS Keychain / libsecret / KWallet Safe Storage password reader.
    pub read_safe_storage_password: SafeStoragePasswordReader,
    /// Windows `Local State` `os_crypt.encrypted_key` reader.
    pub read_windows_encryption_key: WindowsKeyReader,
}

impl Default for KeystoreHooks {
    fn default() -> Self {
        Self {
            read_safe_storage_password: Arc::new(read_safe_storage_password),
            read_windows_encryption_key: Arc::new(read_windows_encryption_key),
        }
    }
}

impl fmt::Debug for KeystoreHooks {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("KeystoreHooks")
            .finish_non_exhaustive()
    }
}

/// Resolves the source profile's decryption key for an encryption prefix
/// (`v10`/`v11`). Linux uses a hardcoded key for `v10` and the keyring for
/// `v11`. Keys are cached per prefix, including failures.
pub type SourceKeyResolver = Arc<dyn Fn(&str) -> Result<Vec<u8>> + Send + Sync>;

/// Build a decryptor key resolver for a source profile.
pub(crate) fn create_source_key_resolver(
    browser: &str,
    platform: &str,
    local_state_path: Option<PathBuf>,
    hooks: KeystoreHooks,
) -> SourceKeyResolver {
    let browser = browser.to_string();
    let platform = platform.to_string();
    let cache: Mutex<HashMap<String, Result<Vec<u8>, String>>> = Mutex::new(HashMap::new());
    Arc::new(move |prefix: &str| {
        let mut cache = cache
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let entry = cache.entry(prefix.to_string()).or_insert_with(|| {
            resolve_source_key(
                &browser,
                &platform,
                prefix,
                local_state_path.as_deref(),
                &hooks,
            )
            .map_err(|error| format!("{error:#}"))
        });
        entry.clone().map_err(|message| anyhow!(message))
    })
}

fn resolve_source_key(
    browser: &str,
    platform: &str,
    prefix: &str,
    local_state_path: Option<&Path>,
    hooks: &KeystoreHooks,
) -> Result<Vec<u8>> {
    match platform {
        "win32" => {
            let path = local_state_path
                .ok_or_else(|| anyhow!("The source Local State path is unknown"))?;
            (hooks.read_windows_encryption_key)(path)
        }
        // Chromium's legacy Linux v10 format uses this fixed fallback secret.
        // Read it only to decrypt an existing source profile; target values
        // use the launching profile's key from Safe Storage below.
        "linux" if prefix == "v10" => derive_chromium_cookie_key("peanuts", "linux"),
        "linux" | "darwin" => {
            let password = (hooks.read_safe_storage_password)(browser, platform)?;
            derive_chromium_cookie_key(&password, platform)
        }
        _ => Err(anyhow!("OSCrypt keys are unsupported on {platform}")),
    }
}

/// A target profile's encryption key and the version prefix to write.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetKey {
    /// Raw AES key.
    pub key: Vec<u8>,
    /// Version prefix written before each encrypted value (`v10` or `v11`).
    pub prefix: String,
}

/// Resolve the target (launching) profile's encryption key on macOS/Linux.
pub(crate) fn resolve_target_key(
    browser: &str,
    platform: &str,
    hooks: &KeystoreHooks,
) -> Result<TargetKey> {
    if platform == "darwin" || platform == "linux" {
        let password = (hooks.read_safe_storage_password)(browser, platform)?;
        return Ok(TargetKey {
            key: derive_chromium_cookie_key(&password, platform)?,
            prefix: "v11".to_string(),
        });
    }
    Err(anyhow!(
        "resolve_target_key does not derive a Windows key; use create_windows_profile_key"
    ))
}

pub(crate) use crate::browser::browser_profile_files::local_state_path_for_profile;
