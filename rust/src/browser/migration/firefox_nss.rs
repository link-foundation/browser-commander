//! NSS decryption for Firefox saved logins, mirroring
//! `js/src/browser/migration/firefox-nss.js`.
//!
//! Firefox does not use OSCrypt; it stores logins in `logins.json` and protects
//! them with NSS. The decryption key lives in `key4.db`:
//!
//! - `metadata` (id `password`) holds a global salt and a password-check blob.
//! - `nssPrivate` holds the encrypted 3DES key used for the actual logins.
//!
//! Two key-wrapping schemes appear in the wild:
//!
//! - Modern Firefox uses PKCS#5 PBES2 (PBKDF2-HMAC-SHA256 then AES-256-CBC).
//!   The PBKDF2 password is `SHA1(globalSalt + primaryPassword)` and NSS stores
//!   only 14 IV bytes, so the real 16-byte CBC IV is `0x04 0x0e` followed by
//!   those bytes.
//! - Legacy profiles use `pbeWithSha1AndTripleDES-CBC`: a SHA1-based KDF
//!   derives a 3DES key and IV from the global salt, the entry salt and the
//!   primary password.
//!
//! The individual login fields are always 3DES-CBC under the recovered key. If
//! a primary password is set and no correct one is supplied, the
//! password-check fails with [`PrimaryPasswordError`] and the caller reports
//! `primary-password-set` instead of guessing.
//!
//! References:
//! - <https://searchfox.org/mozilla-central/source/security/nss> (NSS sources)
//! - <https://github.com/unode/firefox_decrypt> (the reference algorithm)

use aes::Aes256;
use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cbc::cipher::block_padding::{NoPadding, Pkcs7};
use cbc::cipher::{BlockModeDecrypt, KeyIvInit};
use des::TdesEde3;
use hmac::{Hmac, KeyInit, Mac};
use pbkdf2::pbkdf2_hmac;
use rusqlite::{Connection, OptionalExtension};
use sha1::{Digest, Sha1};
use sha2::Sha256;

use super::firefox_der::{decode_der_element, der_children, oid_to_string, DerElement};

type Aes256CbcDecryptor = cbc::Decryptor<Aes256>;
type TdesCbcDecryptor = cbc::Decryptor<TdesEde3>;
type HmacSha1 = Hmac<Sha1>;

const OID_PBES2: &str = "1.2.840.113549.1.5.13";
const OID_PBE_SHA1_3DES: &str = "1.2.840.113549.1.12.5.1.3";

const PASSWORD_CHECK: &[u8] = b"password-check\x02\x02";

/// A primary (master) password blocks decryption.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("Firefox primary password is set")]
pub struct PrimaryPasswordError;

fn child(children: &[DerElement], index: usize) -> Result<&DerElement> {
    children
        .get(index)
        .ok_or_else(|| anyhow!("NSS DER structure is missing a field"))
}

fn integer_value(element: &DerElement) -> Result<u64> {
    element.content.iter().try_fold(0_u64, |value, byte| {
        value
            .checked_mul(256)
            .map(|value| value + u64::from(*byte))
            .ok_or_else(|| anyhow!("NSS DER integer is too large"))
    })
}

/// `SHA-1(globalSalt + primaryPassword)`.
///
/// This is not password storage: `key4.db` fixes the scheme as
/// PBKDF2(SHA-1(globalSalt + primaryPassword)) (and the legacy SHA-1/HMAC KDF
/// below), and reading the profile Firefox wrote requires reproducing that
/// fixed NSS format byte for byte, so SHA-1 cannot be swapped for a slower
/// hash.
fn password_hash(global_salt: &[u8], primary_password: &[u8]) -> Vec<u8> {
    Sha1::new()
        .chain_update(global_salt)
        .chain_update(primary_password)
        .finalize()
        .to_vec()
}

/// Decrypt a PBES2 (PBKDF2-HMAC-SHA256 + AES-256-CBC) blob NSS wrote.
fn decrypt_pbes2(
    algorithm_params: &DerElement,
    ciphertext: &[u8],
    global_salt: &[u8],
    primary_password: &[u8],
) -> Result<Vec<u8>> {
    let scheme = der_children(algorithm_params)?;
    let kdf = der_children(child(&scheme, 0)?)?;
    let encryption_scheme = der_children(child(&scheme, 1)?)?;
    let params = der_children(child(&kdf, 1)?)?;
    let entry_salt = &child(&params, 0)?.content;
    let iterations = u32::try_from(integer_value(child(&params, 1)?)?)
        .context("NSS PBKDF2 iteration count is too large")?;
    let key_length = usize::try_from(integer_value(child(&params, 2)?)?)
        .ok()
        .filter(|length| *length <= 1024)
        .ok_or_else(|| anyhow!("NSS PBKDF2 key length is invalid"))?;
    let iv_bytes = &child(&encryption_scheme, 1)?.content;

    let hash = password_hash(global_salt, primary_password);
    let mut key = vec![0_u8; key_length];
    pbkdf2_hmac::<Sha256>(&hash, entry_salt, iterations, &mut key);
    let iv = [&[0x04_u8, 0x0e][..], iv_bytes].concat();
    Aes256CbcDecryptor::new_from_slices(&key, &iv)
        .map_err(|_| anyhow!("NSS AES-256-CBC key or IV has the wrong length"))?
        .decrypt_padded_vec::<Pkcs7>(ciphertext)
        .map_err(|_| anyhow!("NSS AES-256-CBC padding is invalid"))
}

/// Strip PKCS#7 padding when the last byte is a plausible pad length, the way
/// the reference algorithm does (without verifying every pad byte).
fn pkcs7_unpad(mut buffer: Vec<u8>) -> Vec<u8> {
    if let Some(&pad) = buffer.last() {
        let pad = usize::from(pad);
        if pad > 0 && pad <= buffer.len() {
            buffer.truncate(buffer.len() - pad);
        }
    }
    buffer
}

fn hmac_sha1(key: &[u8], parts: &[&[u8]]) -> Result<Vec<u8>> {
    let mut mac = HmacSha1::new_from_slice(key).map_err(|_| anyhow!("invalid HMAC key"))?;
    for part in parts {
        mac.update(part);
    }
    Ok(mac.finalize().into_bytes().to_vec())
}

fn decrypt_3des_cbc(key: &[u8], iv: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>> {
    let plaintext = TdesCbcDecryptor::new_from_slices(key, iv)
        .map_err(|_| anyhow!("3DES key or IV has the wrong length"))?
        .decrypt_padded_vec::<NoPadding>(ciphertext)
        .map_err(|_| anyhow!("3DES ciphertext is not a whole number of blocks"))?;
    Ok(pkcs7_unpad(plaintext))
}

/// Decrypt the legacy pbeWithSha1AndTripleDES-CBC key blob.
fn decrypt_pbe_sha1_3des(
    algorithm_params: &DerElement,
    ciphertext: &[u8],
    global_salt: &[u8],
    primary_password: &[u8],
) -> Result<Vec<u8>> {
    let params = der_children(algorithm_params)?;
    let entry_salt = &child(&params, 0)?.content;

    // NSS's SHA1-based KDF for pbeWithSha1AndTripleDES-CBC. The entry salt is
    // right-padded with zeros to 20 bytes, and the 3DES key and IV are derived
    // through three chained HMAC-SHA1 rounds. The format is fixed by NSS.
    let hp = password_hash(global_salt, primary_password);
    let mut pes = entry_salt.clone();
    pes.resize(20, 0);
    let chp = Sha1::new()
        .chain_update(&hp)
        .chain_update(entry_salt)
        .finalize()
        .to_vec();
    let k1 = hmac_sha1(&chp, &[&pes, entry_salt])?;
    let tk = hmac_sha1(&chp, &[&pes])?;
    let k2 = hmac_sha1(&chp, &[&tk, entry_salt])?;
    let derived = [k1, k2].concat();
    let key = &derived[..24];
    let iv = &derived[derived.len() - 8..];
    decrypt_3des_cbc(key, iv, ciphertext)
}

fn decrypt_nss_blob(blob: &[u8], global_salt: &[u8], primary_password: &[u8]) -> Result<Vec<u8>> {
    let top = decode_der_element(blob, 0)?;
    let top_children = der_children(&top)?;
    let algorithm = der_children(child(&top_children, 0)?)?;
    let ciphertext = &child(&top_children, 1)?.content;
    let oid = oid_to_string(&child(&algorithm, 0)?.content);
    let params = child(&algorithm, 1)?;
    match oid.as_str() {
        OID_PBES2 => decrypt_pbes2(params, ciphertext, global_salt, primary_password),
        OID_PBE_SHA1_3DES => {
            decrypt_pbe_sha1_3des(params, ciphertext, global_salt, primary_password)
        }
        _ => Err(anyhow!("Unsupported NSS key algorithm {oid}")),
    }
}

/// Recover the 24-byte 3DES login key from an open, read-only `key4.db`.
/// `primary_password` is empty when no primary password is set.
pub(crate) fn recover_firefox_key_from_database(
    database: &Connection,
    primary_password: &[u8],
) -> Result<Vec<u8>> {
    let meta: Option<(Vec<u8>, Vec<u8>)> = database
        .query_row(
            "SELECT item1, item2 FROM metadata WHERE id = 'password'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let (global_salt, check_blob) =
        meta.ok_or_else(|| anyhow!("key4.db has no password metadata"))?;
    // A wrong or missing primary password makes the CBC padding check fail;
    // treat any decryption failure of the password-check blob as a locked key.
    let check = decrypt_nss_blob(&check_blob, &global_salt, primary_password)
        .map_err(|_| anyhow!(PrimaryPasswordError))?;
    if !check.starts_with(PASSWORD_CHECK) {
        return Err(anyhow!(PrimaryPasswordError));
    }
    let private: Option<Vec<u8>> = database
        .query_row("SELECT a11, a102 FROM nssPrivate", [], |row| row.get(0))
        .optional()?;
    let private = private.ok_or_else(|| anyhow!("key4.db has no nssPrivate key"))?;
    let mut decrypted = decrypt_nss_blob(&private, &global_salt, primary_password)?;
    decrypted.truncate(24);
    Ok(decrypted)
}

/// Decrypt one NSS-protected `logins.json` field (username or password).
pub(crate) fn decrypt_firefox_field(base64_value: &str, key: &[u8]) -> Result<String> {
    let blob = BASE64
        .decode(base64_value)
        .context("NSS login field is not base64")?;
    let top = decode_der_element(&blob, 0)?;
    let top_children = der_children(&top)?;
    let algorithm = der_children(child(&top_children, 1)?)?;
    let iv = &child(&algorithm, 1)?.content;
    let ciphertext = &child(&top_children, 2)?.content;
    let plaintext = decrypt_3des_cbc(key, iv, ciphertext)?;
    String::from_utf8(plaintext).context("decrypted login field is not UTF-8")
}
