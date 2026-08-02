//! OS credential-store access for installed Chromium cookie import.

use std::fs;
use std::path::Path;
use std::process::Command;

use anyhow::{anyhow, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::Value;

struct SafeStorageIdentity {
    application: &'static str,
    folder: &'static str,
    service: &'static str,
}

fn safe_storage_identity(browser: &str) -> Result<SafeStorageIdentity> {
    let identity = match browser {
        "brave" => SafeStorageIdentity {
            application: "brave",
            folder: "Brave Keys",
            service: "Brave Safe Storage",
        },
        "chrome" => SafeStorageIdentity {
            application: "chrome",
            folder: "Chrome Keys",
            service: "Chrome Safe Storage",
        },
        "chromium" => SafeStorageIdentity {
            application: "chromium",
            folder: "Chromium Keys",
            service: "Chromium Safe Storage",
        },
        "edge" => SafeStorageIdentity {
            application: "microsoft-edge",
            folder: "Microsoft Edge Keys",
            service: "Microsoft Edge Safe Storage",
        },
        _ => return Err(anyhow!("No Safe Storage identity is known for {browser}")),
    };
    Ok(identity)
}

fn run_credential_command(command: &str, arguments: &[&str]) -> Result<String> {
    let output = Command::new(command)
        .args(arguments)
        .output()
        .with_context(|| format!("Could not start {command}"))?;
    if !output.status.success() {
        return Err(anyhow!("{command} exited with {}", output.status));
    }
    String::from_utf8(output.stdout)
        .context("credential command returned invalid UTF-8")
        .map(|value| value.trim().to_string())
}

pub(crate) fn read_safe_storage_password(browser: &str, platform: &str) -> Result<String> {
    let identity = safe_storage_identity(browser)?;
    if platform == "darwin" {
        let password = run_credential_command(
            "security",
            &["find-generic-password", "-w", "-s", identity.service],
        )?;
        return (!password.is_empty())
            .then_some(password)
            .ok_or_else(|| anyhow!("{} returned an empty password", identity.service));
    }
    if platform == "linux" {
        if let Ok(password) = run_credential_command(
            "secret-tool",
            &["lookup", "application", identity.application],
        ) {
            if !password.is_empty() {
                return Ok(password);
            }
        }
        if let Ok(password) = run_credential_command(
            "kwallet-query",
            &["-r", identity.service, "-f", identity.folder, "kdewallet"],
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
    fn kwallet_identity_uses_chromium_product_casing() {
        let identity = safe_storage_identity("chrome").unwrap();
        assert_eq!(identity.folder, "Chrome Keys");
        assert_eq!(identity.service, "Chrome Safe Storage");
    }
}
