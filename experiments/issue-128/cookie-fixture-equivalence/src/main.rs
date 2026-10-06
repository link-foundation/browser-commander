// Run offline with rust/Cargo.lock copied beside Cargo.toml: cargo run --offline
// Issue #128: the CodeQL-friendly cookie fixture encrypts byte-for-byte as before.
use aes::Aes128;
use cbc::cipher::{block_padding::Pkcs7, BlockModeEncrypt, KeyIvInit};
use pbkdf2::{pbkdf2_hmac, pbkdf2_hmac_array};
use sha1::Sha1;
use sha2::{Digest, Sha256};

type Aes128CbcEncryptor = cbc::Encryptor<Aes128>;
const CHROME_CBC_IV: [u8; 16] = [0x20; 16];

fn old(host: &str, value: &str) -> Vec<u8> {
    let mut key = [0_u8; 16];
    pbkdf2_hmac::<Sha1>(b"peanuts", b"saltysalt", 1, &mut key);
    let mut plaintext = Sha256::digest(host.as_bytes()).to_vec();
    plaintext.extend_from_slice(value.as_bytes());
    let encrypted = Aes128CbcEncryptor::new(&key.into(), &[0x20; 16].into())
        .encrypt_padded_vec::<Pkcs7>(&plaintext);
    [b"v10".as_slice(), encrypted.as_slice()].concat()
}

fn new(host: &str, value: &str) -> Vec<u8> {
    let key = pbkdf2_hmac_array::<Sha1, 16>(b"peanuts", b"saltysalt", 1);
    let mut plaintext = Sha256::digest(host.as_bytes()).to_vec();
    plaintext.extend_from_slice(value.as_bytes());
    let encrypted = Aes128CbcEncryptor::new_from_slices(&key, &CHROME_CBC_IV)
        .expect("a 16-byte key and IV")
        .encrypt_padded_vec::<Pkcs7>(&plaintext);
    [b"v10".as_slice(), encrypted.as_slice()].concat()
}

fn main() {
    let (a, b) = (old(".example.com", "decrypted-session"), new(".example.com", "decrypted-session"));
    println!("old={a:02x?}\nnew={b:02x?}\nequal={}", a == b);
    assert_eq!(a, b);
}
