//! Chromium cookie key derivation and decryption primitives.

use aes::Aes128;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Context, Result};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use sha1::Sha1;
use sha2::{Digest, Sha256};

type Aes128CbcDecryptor = cbc::Decryptor<Aes128>;

pub(crate) fn derive_chromium_cookie_key(password: &str, platform: &str) -> Result<Vec<u8>> {
    let iterations = match platform {
        "darwin" => 1003,
        "linux" => 1,
        _ => return Err(anyhow!("CBC cookie keys are not used on {platform}")),
    };
    let mut key = vec![0_u8; 16];
    pbkdf2_hmac::<Sha1>(password.as_bytes(), b"saltysalt", iterations, &mut key);
    Ok(key)
}

fn remove_domain_hash<'a>(plaintext: &'a [u8], host: &str, version: i64) -> Result<&'a [u8]> {
    if version < 24 {
        return Ok(plaintext);
    }
    if plaintext.len() < 32 {
        return Err(anyhow!("decrypted cookie is missing its domain hash"));
    }
    let expected = Sha256::digest(host.as_bytes());
    if plaintext[..32] != expected[..] {
        return Err(anyhow!(
            "decrypted cookie domain hash does not match its host"
        ));
    }
    Ok(&plaintext[32..])
}

fn decrypt_cbc(encrypted: &[u8], key: &[u8]) -> Result<Vec<u8>> {
    Aes128CbcDecryptor::new_from_slices(key, &[0x20; 16])
        .context("invalid Chromium AES-CBC key")?
        .decrypt_padded_vec_mut::<Pkcs7>(&encrypted[3..])
        .map_err(|_| anyhow!("Chromium AES-CBC cookie padding is invalid"))
}

fn decrypt_gcm(encrypted: &[u8], key: &[u8]) -> Result<Vec<u8>> {
    let payload = &encrypted[3..];
    if payload.len() < 28 {
        return Err(anyhow!("encrypted AES-GCM cookie is truncated"));
    }
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid Chromium AES-GCM key")?;
    cipher
        .decrypt(Nonce::from_slice(&payload[..12]), &payload[12..])
        .map_err(|_| anyhow!("Chromium AES-GCM cookie authentication failed"))
}

pub(crate) fn decrypt_chromium_cookie(
    encrypted: &[u8],
    host: &str,
    database_version: i64,
    platform: &str,
    key: &[u8],
) -> Result<String> {
    if encrypted.len() < 3 {
        return Err(anyhow!("encrypted Chromium cookie is truncated"));
    }
    match &encrypted[..3] {
        b"v20" => {
            return Err(anyhow!(
                "Windows app-bound v20 cookies cannot be decrypted outside the browser; use a browser-supported export or a previously saved storage state"
            ))
        }
        b"v10" | b"v11" => {}
        _ => return Err(anyhow!("cookie has an unsupported Chromium encryption prefix")),
    }
    let plaintext = if platform == "win32" {
        decrypt_gcm(encrypted, key)?
    } else {
        decrypt_cbc(encrypted, key)?
    };
    String::from_utf8(remove_domain_hash(&plaintext, host, database_version)?.to_vec())
        .context("decrypted cookie is not valid UTF-8")
}

pub(crate) fn chromium_same_site(value: i64) -> &'static str {
    match value {
        2 => "Strict",
        1 => "Lax",
        _ => "None",
    }
}

pub(crate) fn firefox_same_site(value: i64) -> &'static str {
    chromium_same_site(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes_gcm::aead::Aead;
    use sha2::Sha256;

    #[test]
    fn decrypts_windows_gcm_and_rejects_app_bound_cookies() {
        let key = [7_u8; 32];
        let host = ".example.test";
        let mut plaintext = Sha256::digest(host.as_bytes()).to_vec();
        plaintext.extend_from_slice(b"windows-session");
        let nonce = [3_u8; 12];
        let ciphertext = Aes256Gcm::new_from_slice(&key)
            .unwrap()
            .encrypt(Nonce::from_slice(&nonce), plaintext.as_slice())
            .unwrap();
        let encrypted = [b"v10".as_slice(), &nonce, ciphertext.as_slice()].concat();
        assert_eq!(
            decrypt_chromium_cookie(&encrypted, host, 24, "win32", &key).unwrap(),
            "windows-session"
        );
        assert!(
            decrypt_chromium_cookie(b"v20app-bound", host, 24, "win32", &key)
                .unwrap_err()
                .to_string()
                .contains("app-bound")
        );
    }

    #[test]
    fn legacy_dpapi_plaintext_validates_version_24_host_hash() {
        let host = ".legacy.example";
        let mut plaintext = Sha256::digest(host.as_bytes()).to_vec();
        plaintext.extend_from_slice(b"legacy-session");
        assert_eq!(
            decode_chromium_plaintext(&plaintext, host, 24).unwrap(),
            "legacy-session"
        );
        assert!(decode_chromium_plaintext(&plaintext, ".wrong.example", 24)
            .unwrap_err()
            .to_string()
            .contains("domain hash does not match"));
    }
}
