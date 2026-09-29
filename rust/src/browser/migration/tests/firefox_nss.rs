//! Mirrors `js/tests/unit/browser/migration/firefox-nss.test.js`.

use rusqlite::{Connection, OpenFlags};

use super::super::firefox_der::{decode_der_element, decode_der_sequence, oid_to_string};
use super::super::firefox_nss::{
    decrypt_firefox_field, recover_firefox_key_from_database, PrimaryPasswordError,
};
use super::fixtures::{build_key4_database, encode_login_field, Key4Fixture, TempDir};

/// Build a key4.db, open it read-only as the migration does, and hand it to
/// `check` together with the fixture.
fn with_key4_database(primary_password: &[u8], check: impl FnOnce(&Connection, &Key4Fixture)) {
    let dir = TempDir::new("bc-nss-");
    let fixture = build_key4_database(dir.path(), primary_password);
    let database =
        Connection::open_with_flags(&fixture.key4_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    check(&database, &fixture);
}

#[test]
fn decodes_a_nested_sequence_and_oid() {
    // SEQUENCE { OID 1.2.840.113549.1.5.13, OCTET STRING 0x01 0x02 }
    let oid = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x05, 0x0d];
    let octet = [0x04, 0x02, 0x01, 0x02];
    let sequence = [
        vec![0x30, (oid.len() + octet.len()) as u8],
        oid.to_vec(),
        octet.to_vec(),
    ]
    .concat();
    let decoded = decode_der_element(&sequence, 0).unwrap();
    let children = decode_der_sequence(&decoded.content).unwrap();
    assert_eq!(oid_to_string(&children[0].content), "1.2.840.113549.1.5.13");
    assert_eq!(children[1].content, vec![0x01, 0x02]);
}

#[test]
fn recovers_the_3des_login_key_via_pbes2_with_no_primary_password() {
    with_key4_database(b"", |database, fixture| {
        let recovered = recover_firefox_key_from_database(database, b"").unwrap();
        assert_eq!(recovered, fixture.login_key);
    });
}

#[test]
fn round_trips_a_login_field_decryption() {
    with_key4_database(b"", |database, _| {
        let recovered = recover_firefox_key_from_database(database, b"").unwrap();
        let encoded = encode_login_field(&recovered, "super-secret");
        assert_eq!(decrypt_firefox_field(&encoded, &recovered).unwrap(), "super-secret");
    });
}

#[test]
fn fails_with_primary_password_error_when_the_wrong_password_is_supplied() {
    with_key4_database(b"correct horse", |database, _| {
        let error = recover_firefox_key_from_database(database, b"wrong").unwrap_err();
        assert!(error.is::<PrimaryPasswordError>(), "{error:#}");
    });
}

#[test]
fn recovers_with_the_correct_primary_password() {
    with_key4_database(b"correct horse", |database, fixture| {
        assert_eq!(
            recover_firefox_key_from_database(database, b"correct horse").unwrap(),
            fixture.login_key
        );
    });
}

#[test]
fn reports_a_helpful_error_when_metadata_is_missing() {
    let dir = TempDir::new("bc-nss-");
    let key4_path = dir.path().join("key4.db");
    Connection::open(&key4_path)
        .unwrap()
        .execute_batch("CREATE TABLE metadata (id TEXT, item1 BLOB, item2 BLOB)")
        .unwrap();
    let database =
        Connection::open_with_flags(&key4_path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let error = recover_firefox_key_from_database(&database, b"").unwrap_err();
    assert!(error.to_string().contains("no password metadata"));
}
