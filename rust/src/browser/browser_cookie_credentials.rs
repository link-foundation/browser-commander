//! OS credential-store access for installed Chromium cookie import.

use std::fs;
use std::path::Path;

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::Value;

use super::browser_sources::{safe_storage_identity as catalogue_identity, SafeStorageIdentity};
use crate::utilities::subprocess::{run_command_blocking, CommandError, RunCommandOptions};

fn safe_storage_identity(browser: &str) -> Result<&'static SafeStorageIdentity> {
    catalogue_identity(browser)?
        .ok_or_else(|| anyhow!("No Safe Storage identity is known for {browser}"))
}

/// Run a credential tool through command-stream (issue #104) with exact argv
/// and return its trimmed stdout.
fn run_credential_command(command: &str, arguments: &[&str]) -> Result<String> {
    match run_command_blocking(command, arguments, RunCommandOptions::default()) {
        Ok(output) => Ok(output.stdout.trim().to_string()),
        Err(CommandError::Spawn { message, .. }) => {
            Err(anyhow!("Could not start {command}: {message}"))
        }
        Err(CommandError::Exited { code, .. }) => Err(anyhow!("{command} exited with code {code}")),
    }
}

pub(crate) fn read_safe_storage_password(browser: &str, platform: &str) -> Result<String> {
    read_safe_storage_password_with_runner(browser, platform, run_credential_command)
}

fn read_safe_storage_password_with_runner(
    browser: &str,
    platform: &str,
    run: impl Fn(&str, &[&str]) -> Result<String>,
) -> Result<String> {
    let identity = safe_storage_identity(browser)?;
    if platform == "darwin" {
        let password = run(
            "security",
            &["find-generic-password", "-w", "-s", &identity.service],
        )
        .and_then(|password| {
            if password.is_empty() {
                Err(anyhow!("{} returned an empty password", identity.service))
            } else {
                Ok(password)
            }
        });
        return password.with_context(|| format!(
            "Could not read {} from macOS Keychain. Unlock the login Keychain and allow the app running Browser Commander to access this item, then retry with refresh=true.",
            identity.service
        ));
    }
    if platform == "linux" {
        if let Ok(password) = run(
            "secret-tool",
            &["lookup", "application", &identity.application],
        ) {
            if !password.is_empty() {
                return Ok(password);
            }
        }
        if let Ok(password) = run(
            "kwallet-query",
            &["-r", &identity.service, "-f", &identity.folder, "kdewallet"],
        ) {
            if !password.is_empty() {
                return Ok(password);
            }
        }
        return Err(anyhow!(
            "Could not read {} from libsecret or KWallet; install secret-tool or unlock the browser key store",
            identity.service
        ));
    }
    Err(anyhow!("Safe Storage passwords are not used on {platform}"))
}

const DPAPI_SCRIPT: &str = concat!(
    "$inputBytes=[Convert]::FromBase64String($args[0]);",
    "$outputBytes=[Security.Cryptography.ProtectedData]::Unprotect(",
    "$inputBytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);",
    "[Convert]::ToBase64String($outputBytes)"
);

pub(crate) fn decrypt_windows_dpapi(encrypted: &[u8]) -> Result<Vec<u8>> {
    let encoded = BASE64.encode(encrypted);
    let output = run_credential_command(
        "powershell.exe",
        &[
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            DPAPI_SCRIPT,
            &encoded,
        ],
    )?;
    BASE64
        .decode(output)
        .context("DPAPI command returned invalid base64")
}

pub(crate) fn read_windows_encryption_key(local_state_path: &Path) -> Result<Vec<u8>> {
    let contents = fs::read_to_string(local_state_path).with_context(|| {
        format!(
            "Could not read Chromium Local State {}",
            local_state_path.display()
        )
    })?;
    let state: Value = serde_json::from_str(&contents).context("Invalid Chromium Local State")?;
    let encoded = state
        .pointer("/os_crypt/encrypted_key")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Chromium Local State has no os_crypt.encrypted_key"))?;
    let encrypted_key = BASE64
        .decode(encoded)
        .context("Chromium Local State encrypted_key is not base64")?;
    let protected = encrypted_key
        .strip_prefix(b"DPAPI")
        .ok_or_else(|| anyhow!("Chromium Local State key does not have a DPAPI prefix"))?;
    decrypt_windows_dpapi(protected)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_reader_identity_matches_every_catalogue_browser() {
        for browser in super::super::browser_sources::browser_sources() {
            let Some(expected) = &browser.safe_storage else {
                continue;
            };
            for name in std::iter::once(&browser.id).chain(browser.aliases.iter()) {
                let actual = safe_storage_identity(name).unwrap();
                assert_eq!(actual.service, expected.service);
                assert_eq!(actual.application, expected.application);
                assert_eq!(actual.folder, expected.folder);
                let password =
                    read_safe_storage_password_with_runner(name, "darwin", |command, arguments| {
                        assert_eq!(command, "security");
                        assert_eq!(
                            arguments,
                            [
                                "find-generic-password",
                                "-w",
                                "-s",
                                expected.service.as_str()
                            ]
                        );
                        Ok("synthetic-password".into())
                    })
                    .unwrap();
                assert_eq!(password, "synthetic-password");
            }
        }
    }

    #[test]
    fn keychain_errors_identify_item_and_supported_retry() {
        for denied in [true, false] {
            let error = read_safe_storage_password_with_runner("chrome", "darwin", |_, _| {
                if denied {
                    Err(anyhow!("security exited with code 36"))
                } else {
                    Ok(String::new())
                }
            })
            .unwrap_err();
            let detail = error.to_string();
            for expected in [
                "Chrome Safe Storage",
                "Keychain",
                "allow",
                "retry",
                "refresh=true",
            ] {
                assert!(detail.contains(expected), "{detail}");
            }
        }
    }

    #[test]
    fn kwallet_identity_uses_chromium_product_casing() {
        let identity = safe_storage_identity("chrome").unwrap();
        assert_eq!(identity.folder, "Chrome Keys");
        assert_eq!(identity.service, "Chrome Safe Storage");
    }
}
