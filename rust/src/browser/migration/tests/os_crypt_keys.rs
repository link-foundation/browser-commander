//! Mirrors `js/tests/unit/browser/migration/os-crypt-keys.test.js`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use super::super::os_crypt_keys::{
    create_source_key_resolver, local_state_path_for_profile, resolve_target_key, KeystoreHooks,
};
use crate::browser::browser_cookie_crypto::derive_chromium_cookie_key;

fn hooks_with_password(password: &'static str) -> KeystoreHooks {
    KeystoreHooks {
        read_safe_storage_password: Arc::new(move |_, _| Ok(password.to_string())),
        ..KeystoreHooks::default()
    }
}

fn failing_hooks() -> KeystoreHooks {
    KeystoreHooks {
        read_safe_storage_password: Arc::new(|_, _| Err(anyhow::anyhow!("no keyring in tests"))),
        read_windows_encryption_key: Arc::new(|_| Err(anyhow::anyhow!("no DPAPI in tests"))),
    }
}

#[test]
fn uses_the_hardcoded_key_for_linux_v10() {
    let resolve = create_source_key_resolver("chromium", "linux", None, failing_hooks());
    assert_eq!(
        resolve("v10").unwrap(),
        derive_chromium_cookie_key("peanuts", "linux").unwrap()
    );
}

#[test]
fn derives_the_safe_storage_key_for_linux_v11_and_caches_it() {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&calls);
    let hooks = KeystoreHooks {
        read_safe_storage_password: Arc::new(move |_, _| {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok("keyring-pass".to_string())
        }),
        ..failing_hooks()
    };
    let resolve = create_source_key_resolver("chrome", "linux", None, hooks);
    let first = resolve("v11").unwrap();
    let second = resolve("v11").unwrap();
    assert_eq!(first, derive_chromium_cookie_key("keyring-pass", "linux").unwrap());
    assert_eq!(second, first);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

#[test]
fn reads_the_windows_key_from_local_state() {
    let hooks = KeystoreHooks {
        read_windows_encryption_key: Arc::new(|local_state_path: &Path| {
            assert_eq!(local_state_path, Path::new("/fake/Local State"));
            Ok(vec![9_u8; 32])
        }),
        ..failing_hooks()
    };
    let resolve = create_source_key_resolver(
        "chrome",
        "win32",
        Some(PathBuf::from("/fake/Local State")),
        hooks,
    );
    assert_eq!(resolve("v10").unwrap(), vec![9_u8; 32]);
}

#[test]
fn derives_the_macos_safe_storage_key() {
    let resolve = create_source_key_resolver("chrome", "darwin", None, hooks_with_password("mac-pass"));
    assert_eq!(
        resolve("v10").unwrap(),
        derive_chromium_cookie_key("mac-pass", "darwin").unwrap()
    );
}

#[test]
fn derives_the_launching_profile_key_on_macos_and_linux() {
    let result = resolve_target_key("chrome", "linux", &hooks_with_password("target-pass")).unwrap();
    assert_eq!(result.key, derive_chromium_cookie_key("target-pass", "linux").unwrap());
    assert_eq!(result.prefix, "v11");
}

#[test]
fn refuses_to_derive_a_windows_key() {
    let error = resolve_target_key("chrome", "win32", &failing_hooks()).unwrap_err();
    assert!(error.to_string().contains("create_windows_profile_key"));
}

#[test]
fn points_at_local_state_next_to_the_profile_directory() {
    assert_eq!(
        local_state_path_for_profile(Path::new("/root/google-chrome/Default")),
        Path::new("/root/google-chrome").join("Local State")
    );
}
