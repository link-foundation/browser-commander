//! Mirrors `js/tests/unit/browser/migration/chromium-crypto.test.js`.

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

use super::super::chromium_crypto::{
    create_windows_profile_key, encrypt_chromium_value, random_bytes,
};
use crate::browser::browser_cookie_crypto::{decrypt_chromium_cookie, derive_chromium_cookie_key};

#[test]
fn round_trips_through_aes_128_cbc_on_darwin_and_linux() {
    for platform in ["darwin", "linux"] {
        let key = derive_chromium_cookie_key("safe-storage-pass", platform).unwrap();
        let encrypted = encrypt_chromium_value(b"hunter2", &key, platform, Some("v11")).unwrap();
        assert_eq!(&encrypted[..3], b"v11");
        let decrypted =
            decrypt_chromium_cookie(&encrypted, "accounts.example.com", 0, platform, &key).unwrap();
        assert_eq!(decrypted, "hunter2", "{platform}");
    }
}

#[test]
fn round_trips_through_aes_256_gcm_on_win32() {
    let key = random_bytes(32).unwrap();
    let encrypted = encrypt_chromium_value(b"p@ssw0rd", &key, "win32", Some("v10")).unwrap();
    assert_eq!(&encrypted[..3], b"v10");
    let decrypted =
        decrypt_chromium_cookie(&encrypted, "login.example.com", 0, "win32", &key).unwrap();
    assert_eq!(decrypted, "p@ssw0rd");
}

#[test]
fn requires_a_key_and_a_supported_platform() {
    let error = encrypt_chromium_value(b"x", &[], "linux", None).unwrap_err();
    assert!(error.to_string().contains("target encryption key"));
    let error =
        encrypt_chromium_value(b"x", &random_bytes(16).unwrap(), "sunos", None).unwrap_err();
    assert!(error.to_string().contains("unsupported"));
}

#[test]
fn tags_the_dpapi_protected_key_and_base64_encodes_it() {
    let encrypt_dpapi = |input: &[u8]| Ok([b"ENC".as_slice(), input].concat());
    let generate_key = || Ok(vec![7_u8; 32]);
    let profile_key = create_windows_profile_key(&encrypt_dpapi, Some(&generate_key)).unwrap();
    assert_eq!(profile_key.key.len(), 32);
    let decoded = BASE64.decode(profile_key.encrypted_key_base64).unwrap();
    assert_eq!(&decoded[..5], b"DPAPI");
    assert_eq!(&decoded[5..8], b"ENC");
    assert_eq!(&decoded[8..], vec![7_u8; 32].as_slice());
}

#[test]
fn propagates_a_failing_dpapi_encryptor() {
    // The JavaScript "requires an encryptDpapi function" case is enforced by
    // the Rust signature; a failing encryptor must still surface its error.
    let encrypt_dpapi = |_: &[u8]| Err(anyhow::anyhow!("encryptDpapi failed"));
    let error = create_windows_profile_key(&encrypt_dpapi, None).unwrap_err();
    assert!(error.to_string().contains("encryptDpapi"));
}
