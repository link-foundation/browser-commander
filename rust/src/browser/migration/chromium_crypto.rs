//! Re-encryption for Chromium os_crypt values (passwords, and any other value
//! stored the same way as cookies), mirroring
//! `js/src/browser/migration/chromium-crypto.js`.
//!
//! `browser_cookie_crypto` already decrypts these values; this module is the
//! write side, so a value decrypted from the source profile can be encrypted
//! for the dedicated target profile's key.
//!
//! The wire format matches what Chromium's `OSCrypt` writes:
//! - macOS/Linux: a `v10`/`v11` prefix followed by AES-128-CBC with a fixed
//!   16-byte IV of `0x20`. The key is PBKDF2-SHA1 of the Safe Storage password.
//! - Windows: a `v10` prefix followed by a 12-byte nonce, AES-256-GCM
//!   ciphertext, and the 16-byte auth tag. The key is the random 256-bit key in
//!   `Local State` `os_crypt.encrypted_key`, itself DPAPI-protected.
//!
//! Unlike the Cookies database at schema version 24, `Login Data` values do not
//! carry the SHA-256(host) domain-hash prefix, so nothing is prepended here.

use aes::Aes128;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cbc::cipher::{block_padding::Pkcs7, BlockModeEncrypt, KeyIvInit};

type Aes128CbcEncryptor = cbc::Encryptor<Aes128>;

const CBC_IV: [u8; 16] = [0x20; 16];
const GCM_NONCE_BYTES: usize = 12;

/// Fill a buffer with operating-system randomness.
pub(crate) fn random_bytes(length: usize) -> Result<Vec<u8>> {
    let mut buffer = vec![0_u8; length];
    getrandom::fill(&mut buffer).map_err(|error| anyhow!("Could not read randomness: {error}"))?;
    Ok(buffer)
}

/// Encrypt a value the way Chromium's OSCrypt does for `platform`
/// (`darwin`, `linux` or `win32`). `prefix` defaults to `v10`.
pub(crate) fn encrypt_chromium_value(
    plaintext: &[u8],
    key: &[u8],
    platform: &str,
    prefix: Option<&str>,
) -> Result<Vec<u8>> {
    if key.is_empty() {
        return Err(anyhow!("a target encryption key is required"));
    }
    let prefix = prefix.unwrap_or("v10").as_bytes();
    match platform {
        "win32" => {
            let nonce_bytes = random_bytes(GCM_NONCE_BYTES)?;
            let cipher = Aes256Gcm::new_from_slice(key).context("invalid AES-256-GCM key")?;
            let nonce = Nonce::try_from(nonce_bytes.as_slice())
                .map_err(|_| anyhow!("AES-GCM nonce is not 12 bytes"))?;
            // aes-gcm appends the 16-byte tag to the ciphertext, which is the
            // exact layout Chromium stores.
            let sealed = cipher
                .encrypt(&nonce, plaintext)
                .map_err(|_| anyhow!("AES-256-GCM encryption failed"))?;
            Ok([prefix, &nonce_bytes, &sealed].concat())
        }
        "darwin" | "linux" => {
            let ciphertext = Aes128CbcEncryptor::new_from_slices(key, &CBC_IV)
                .context("invalid AES-128-CBC key")?
                .encrypt_padded_vec::<Pkcs7>(plaintext);
            Ok([prefix, &ciphertext].concat())
        }
        _ => Err(anyhow!(
            "Chromium value encryption is unsupported on {platform}"
        )),
    }
}

/// The raw key and `Local State` `os_crypt.encrypted_key` of a fresh Windows
/// profile.
// The Windows launcher path that writes a fresh `Local State` key is not wired
// up yet (as in JavaScript, only the tests call it today).
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WindowsProfileKey {
    /// The raw 256-bit AES-GCM key.
    pub key: Vec<u8>,
    /// `base64("DPAPI" + DPAPI(key))`, as Chromium writes it.
    pub encrypted_key_base64: String,
}

/// Build the `os_crypt.encrypted_key` a fresh Windows profile needs.
///
/// Chromium generates a random 256-bit key, DPAPI-protects it in the current
/// user's context, prepends the ASCII tag `DPAPI`, and base64-encodes the
/// result into `Local State`. `encrypt_dpapi` is injected so the generation is
/// testable off Windows; `generate_key` defaults to 32 random bytes.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn create_windows_profile_key(
    encrypt_dpapi: &dyn Fn(&[u8]) -> Result<Vec<u8>>,
    generate_key: Option<&dyn Fn() -> Result<Vec<u8>>>,
) -> Result<WindowsProfileKey> {
    let key = match generate_key {
        Some(generate) => generate()?,
        None => random_bytes(32)?,
    };
    let protected = encrypt_dpapi(&key)?;
    let tagged = [b"DPAPI".as_slice(), &protected].concat();
    Ok(WindowsProfileKey {
        key,
        encrypted_key_base64: BASE64.encode(tagged),
    })
}
