//! Regression tests for issue #77.
//!
//! `fantoccini`'s default feature set is `native-tls`, which drags `openssl-sys`
//! into the dependency tree of every consumer of this crate and breaks the build
//! on any image that has a Rust toolchain but no `pkg-config`/OpenSSL headers.
//! The manifest must therefore keep taking `fantoccini` with default features
//! disabled and `rustls-tls` selected.
//!
//! The check is on the manifest rather than on a resolved dependency graph so it
//! runs offline and in milliseconds; the "no `openssl-sys` in the tree" property
//! itself is asserted by the `no-openssl` CI job, which builds the crate inside
//! a plain `rust:slim-bookworm` container with no `apt-get` step.

use std::fs;

fn manifest() -> String {
    fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml"))
        .expect("Cargo.toml must be readable")
}

fn fantoccini_line(manifest: &str) -> String {
    manifest
        .lines()
        .find(|line| line.trim_start().starts_with("fantoccini"))
        .unwrap_or_else(|| panic!("Cargo.toml must declare a fantoccini dependency"))
        .to_string()
}

#[test]
fn fantoccini_is_taken_without_default_features() {
    let line = fantoccini_line(&manifest());
    assert!(
        line.contains("default-features = false"),
        "fantoccini must be taken with `default-features = false` so its \
         `native-tls` default does not force openssl-sys on consumers; got: {line}"
    );
}

#[test]
fn fantoccini_uses_rustls() {
    let line = fantoccini_line(&manifest());
    assert!(
        line.contains("\"rustls-tls\""),
        "fantoccini must enable `rustls-tls` to keep a working TLS stack; got: {line}"
    );
    assert!(
        !line.contains("\"native-tls\""),
        "fantoccini must not enable `native-tls` by default; got: {line}"
    );
}

#[test]
fn native_tls_is_available_as_an_opt_in_feature() {
    let manifest = manifest();
    assert!(
        manifest.contains("native-tls = [\"fantoccini/native-tls\"]"),
        "the system TLS stack must stay reachable as an opt-in `native-tls` feature"
    );
}

#[test]
fn default_feature_set_is_empty() {
    let manifest = manifest();
    assert!(
        manifest.contains("default = []"),
        "the default feature set must stay empty so no TLS backend is forced on consumers"
    );
}
