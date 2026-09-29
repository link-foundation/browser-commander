//! Unit tests for profile migration, one module per JavaScript test file in
//! `js/tests/unit/browser/migration/`. Everything runs against fixtures on
//! disk and injected keystore/cookie readers; no browser or network is used.

mod fixtures;

mod bookmarks;
mod chromium_crypto;
mod cookies;
mod extensions;
mod firefox;
mod firefox_nss;
mod history;
mod index;
mod os_crypt_keys;
mod passwords;
mod preferences;
mod sqlite_snapshot;
