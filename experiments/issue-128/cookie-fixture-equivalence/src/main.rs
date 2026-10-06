// Run offline with rust/Cargo.lock copied beside Cargo.toml: cargo run --offline
// Issue #128: the CodeQL-friendly cookie fixture encrypts byte-for-byte as before.
use aes::Aes128;
use cbc::cipher::{block_padding::Pkcs7, BlockModeEncrypt, KeyIvInit};
use pbkdf2::pbkdf2_hmac_array;
use sha1::Sha1;
use sha2::{Digest, Sha256};

type Aes128CbcEncryptor = cbc::Encryptor<Aes128>;
const CHROME_CBC_IV: [u8; 16] = [0x20; 16];

// What the fixture before 3a31c23 produced for (".example.com", "decrypted-session"),
// recorded by running the old code (see the "old=" line in
// dev/log/issues/128/pulls/129/reproductions/cookie-fixture-equivalence.log).
const OLD_FIXTURE_OUTPUT: [u8; 67] = [
    0x76, 0x31, 0x30, 0x1b, 0xb6, 0x54, 0x83, 0x3f, 0xa6, 0xf8, 0xa7, 0x31, 0x52, 0x8d, 0xb9, 0x2d,
    0x65, 0x7d, 0xc3, 0x7c, 0x87, 0x54, 0x4a, 0x81, 0xba, 0x78, 0x75, 0xd0, 0x68, 0x12, 0x73, 0x54,
    0x3b, 0x4e, 0x4f, 0x58, 0x53, 0xa2, 0xf0, 0x7a, 0x29, 0xe0, 0x97, 0xdb, 0x9d, 0xa0, 0x88, 0x97,
    0x83, 0x1d, 0x80, 0x74, 0x37, 0x84, 0x7e, 0xc4, 0xe9, 0x72, 0x52, 0x5a, 0x29, 0xc0, 0x38, 0x5e,
    0x23, 0x55, 0x15,
];

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
    let (a, b) = (
        OLD_FIXTURE_OUTPUT.as_slice(),
        new(".example.com", "decrypted-session"),
    );
    println!("old={a:02x?}\nnew={b:02x?}\nequal={}", a == b.as_slice());
    assert_eq!(a, b.as_slice());
}
