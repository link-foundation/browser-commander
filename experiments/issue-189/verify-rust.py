"""Compile real password modules without the memory-heavy browser protocol crate.

The unrelated Firefox cookie reader is stubbed; the password writers, crypto,
SQLite snapshots, metadata and regression tests are the repository's real files.
Full-crate builds and integration tests remain required in CI.
"""

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "rust/src/browser/migration"
manifest = (ROOT / "rust/Cargo.toml").read_text()
deps = [
    "tokio",
    "libc",
    "command-stream",
    "tracing",
    "thiserror",
    "anyhow",
    "rusqlite",
    "regex",
    "url",
    "serde",
    "serde_json",
    "aes",
    "aes-gcm",
    "cbc",
    "pbkdf2",
    "sha1",
    "sha2",
    "des",
    "hmac",
    "getrandom",
    "base64",
]
dependencies = "\n".join(
    re.search(rf"^{re.escape(name)} = .+$", manifest, re.MULTILINE)[0] for name in deps
)
types = (
    (MIGRATION / "mod.rs")
    .read_text()
    .split("/// One skipped item")[1]
    .split("/// Per-class migrated counts.")[0]
)
types = "/// One skipped item" + types
validation = (
    (MIGRATION / "validation.rs").read_text().split("pub(crate) fn validate_paths")[1]
)
validation = "pub(crate) fn validate_paths" + validation


def module(name, file):
    return f'#[path = "{file}"] pub(crate) mod {name};\n'


with tempfile.TemporaryDirectory(prefix="bc-password-rust-") as directory:
    project = Path(directory)
    shutil.copyfile(ROOT / "rust/Cargo.lock", project / "Cargo.lock")
    (project / "Cargo.toml").write_text(
        '[package]\nname="password-refresh-verification"\nversion="0.0.0"\nedition="2021"\n[dependencies]\n'
        + dependencies
        + '\n[lib]\npath="lib.rs"\n'
    )
    body = (
        "#![allow(dead_code)]\nmod utilities {\n"
        + module("subprocess", ROOT / "rust/src/utilities/subprocess.rs")
        + "}\nmod browser {\n"
    )
    for name in ["browser_cookie_crypto", "browser_profile_files"]:
        body += module(name, ROOT / f"rust/src/browser/{name}.rs")
    body += (
        """mod browser_cookies {
        pub struct BrowserCookie { pub name: String, pub value: String, pub domain: String, pub path: String, pub expires: i64, pub http_only: bool, pub secure: bool, pub same_site: String }
        pub fn read_firefox_cookies(_: &rusqlite::Connection, _: Option<&str>) -> anyhow::Result<Vec<BrowserCookie>> { anyhow::bail!("Cookie reader outside this focused harness") }
    }
    mod migration {
    use serde::{Serialize, Deserialize};
    """
        + types
    )
    body += "mod os_crypt_keys { pub type SourceKeyResolver = std::sync::Arc<dyn Fn(&str) -> anyhow::Result<Vec<u8>> + Send + Sync>; }\n#[cfg(test)] use os_crypt_keys::SourceKeyResolver;\n"
    body += (
        "mod validation { use std::path::Path; use anyhow::{anyhow, Result}; use crate::browser::browser_profile_files::physical_path;\n"
        + validation
        + "}\n"
    )
    for name in [
        "password_store",
        "passwords",
        "password_metadata",
        "chromium_crypto",
        "sqlite_snapshot",
        "fs_utils",
        "domains",
        "firefox",
        "firefox_nss",
        "firefox_der",
        "firefox_bookmarks",
    ]:
        body += module(name, MIGRATION / f"{name}.rs")
    body += "#[cfg(test)] mod tests {\n"
    for name in ["fixtures", "password_refresh"]:
        body += module(name, MIGRATION / f"tests/{name}.rs")
    body += "}\n}\n}\n"
    (project / "lib.rs").write_text(body)
    env = {
        **os.environ,
        "CARGO_BUILD_JOBS": "1",
        "CARGO_PROFILE_DEV_DEBUG": "0",
        "CARGO_PROFILE_TEST_DEBUG": "0",
        "CARGO_TARGET_DIR": str(ROOT / "rust/target"),
    }
    subprocess.run(
        ["cargo", "test", "--manifest-path", str(project / "Cargo.toml")],
        env=env,
        check=True,
    )
    subprocess.run(
        [
            "cargo",
            "clippy",
            "--manifest-path",
            str(project / "Cargo.toml"),
            "--all-targets",
            "--",
            "-D",
            "warnings",
        ],
        env=env,
        check=True,
    )
