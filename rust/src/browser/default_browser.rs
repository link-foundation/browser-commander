//! Resolve the operating-system default web browser to a canonical catalogue id
//! (#114), so `browser: "default"` imports from whichever browser a person
//! actually uses. Mirrors `js/src/browser/default-browser.js`.
//!
//! Each platform records the default differently:
//!
//! - macOS keeps it in the LaunchServices database as the `https` URL-scheme
//!   handler's bundle id (`defaults read
//!   com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers`).
//! - Linux reports it through `xdg-settings get default-web-browser` (a
//!   `.desktop` file name), falling back to the `x-scheme-handler/https`
//!   association from `xdg-mime`.
//! - Windows stores the `https` UserChoice ProgId under
//!   `HKCU\...\UrlAssociations\https\UserChoice`.
//!
//! Every lookup runs through an injected [`RunCommand`] so the resolver is
//! deterministic in tests, and the raw identifier is matched against the
//! `default` identifiers each browser declares in `browser-sources.json`.

use std::sync::{Arc, LazyLock};

use anyhow::Result;
use regex::Regex;

use super::browser_sources::{browser_sources, Environment};
use crate::utilities::subprocess::{run_command_blocking, RunCommandOptions};

/// A command runner: `(command, args, environment) -> stdout`. A spawn failure
/// (for example a missing binary) is an `Err`; any exit code, even non-zero, is
/// an `Ok` with the captured stdout. Injected so the resolver is deterministic
/// in tests.
pub type RunCommand = Arc<dyn Fn(&str, &[&str], &Environment) -> Result<String> + Send + Sync>;

/// The default [`RunCommand`], backed by a real (shell-free) subprocess.
pub fn default_run_command() -> RunCommand {
    Arc::new(|command, args, environment| {
        let output = run_command_blocking(
            command,
            args,
            RunCommandOptions {
                env: Some(environment.clone()),
                check: false,
                ..RunCommandOptions::default()
            },
        )?;
        Ok(output.stdout)
    })
}

static MAC_HTTPS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"LSHandlerURLScheme\s*=\s*"?https"?\s*;"#).expect("valid regex"));
static MAC_ROLE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"LSHandlerRoleAll\s*=\s*"?([^";]+)"?\s*;"#).expect("valid regex")
});
static WIN_PROGID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\bProgId\b").expect("valid regex"));

/// Match a raw OS identifier (bundle id, `.desktop` name or ProgId) to a
/// canonical browser id. Comparison is case-insensitive because the registry
/// and the operating systems disagree on casing.
pub fn browser_for_identifier(identifier: &str, platform: &str) -> Option<&'static str> {
    let needle = identifier.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    for source in browser_sources() {
        if let Some(identifiers) = source.default.get(platform) {
            if identifiers
                .iter()
                .any(|candidate| candidate.to_lowercase() == needle)
            {
                return Some(source.id.as_str());
            }
        }
    }
    None
}

/// Read the `https` handler bundle id out of `defaults read ... LSHandlers`
/// output. The output is NeXTSTEP-style plist text; each handler is a brace
/// block that may carry an `LSHandlerURLScheme` and an `LSHandlerRoleAll`.
pub fn parse_mac_launch_services_handler(output: &str) -> Option<String> {
    for block in output.split('}') {
        if !MAC_HTTPS.is_match(block) {
            continue;
        }
        if let Some(captures) = MAC_ROLE.captures(block) {
            return Some(captures[1].trim().to_string());
        }
    }
    None
}

/// Read the ProgId out of `reg query ... /v ProgId` output: `reg` prints
/// `    ProgId    REG_SZ    FirefoxHTML`, so take the last whitespace token of
/// the ProgId line.
pub fn parse_windows_prog_id(output: &str) -> Option<String> {
    for raw_line in output.split('\n') {
        let line = raw_line.trim_end_matches('\r');
        if WIN_PROGID.is_match(line) {
            return line.split_whitespace().last().map(str::to_string);
        }
    }
    None
}

fn resolve_darwin_default(
    run_command: &RunCommand,
    environment: &Environment,
) -> Result<Option<&'static str>> {
    let output = run_command(
        "defaults",
        &[
            "read",
            "com.apple.LaunchServices/com.apple.launchservices.secure",
            "LSHandlers",
        ],
        environment,
    )?;
    Ok(parse_mac_launch_services_handler(&output)
        .and_then(|identifier| browser_for_identifier(&identifier, "darwin")))
}

fn resolve_linux_default(
    run_command: &RunCommand,
    environment: &Environment,
) -> Result<Option<&'static str>> {
    let desktop = run_command("xdg-settings", &["get", "default-web-browser"], environment)
        .map(|stdout| stdout.trim().to_string())
        .unwrap_or_default();
    if let Some(resolved) = browser_for_identifier(&desktop, "linux") {
        return Ok(Some(resolved));
    }
    let fallback = match run_command(
        "xdg-mime",
        &["query", "default", "x-scheme-handler/https"],
        environment,
    ) {
        Ok(stdout) => stdout.trim().to_string(),
        Err(_) => return Ok(None),
    };
    Ok(browser_for_identifier(&fallback, "linux"))
}

fn resolve_windows_default(
    run_command: &RunCommand,
    environment: &Environment,
) -> Result<Option<&'static str>> {
    let output = match run_command(
        "reg",
        &[
            "query",
            "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
            "/v",
            "ProgId",
        ],
        environment,
    ) {
        Ok(output) => output,
        Err(_) => return Ok(None),
    };
    Ok(parse_windows_prog_id(&output)
        .and_then(|identifier| browser_for_identifier(&identifier, "win32")))
}

/// Resolve the system default browser to a canonical catalogue id, or `None`
/// when it cannot be determined. On macOS a failure of the lookup tool
/// propagates as an error (there is no fallback); on Linux and Windows a missing
/// tool resolves to `None`.
pub fn resolve_default_browser(
    platform: &str,
    environment: &Environment,
    run_command: &RunCommand,
) -> Result<Option<&'static str>> {
    match platform {
        "darwin" => resolve_darwin_default(run_command, environment),
        "linux" => resolve_linux_default(run_command, environment),
        "win32" => resolve_windows_default(run_command, environment),
        _ => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    // feature-parity: sources.default-browser@native-typed
    use super::*;
    use std::collections::HashMap;

    fn runner_returning(pairs: &[(&'static str, &'static str)]) -> RunCommand {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(key, value)| ((*key).to_string(), (*value).to_string()))
            .collect();
        Arc::new(move |command: &str, args: &[&str], _env: &Environment| {
            let key = std::iter::once(command)
                .chain(args.iter().copied())
                .collect::<Vec<_>>()
                .join(" ");
            map.get(&key)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("unexpected command: {key}"))
        })
    }

    fn resolve(platform: &str, run_command: &RunCommand) -> Option<&'static str> {
        resolve_default_browser(platform, &Environment::new(), run_command).unwrap()
    }

    #[test]
    fn maps_a_macos_launch_services_https_handler_to_a_browser_id() {
        let output = "(\n      {\n        LSHandlerRoleAll = \"com.apple.safari\";\n        \
             LSHandlerURLScheme = mailto;\n      },\n      {\n        \
             LSHandlerRoleAll = \"com.google.chrome\";\n        \
             LSHandlerURLScheme = https;\n      }\n    )";
        let run_command = runner_returning(&[(
            "defaults read com.apple.LaunchServices/com.apple.launchservices.secure LSHandlers",
            output,
        )]);
        assert_eq!(resolve("darwin", &run_command), Some("chrome"));
    }

    #[test]
    fn maps_a_linux_xdg_settings_desktop_name_to_a_browser_id() {
        let run_command =
            runner_returning(&[("xdg-settings get default-web-browser", "firefox.desktop\n")]);
        assert_eq!(resolve("linux", &run_command), Some("firefox"));
    }

    #[test]
    fn falls_back_to_xdg_mime_when_xdg_settings_is_unknown() {
        let run_command = runner_returning(&[
            (
                "xdg-settings get default-web-browser",
                "some-unknown.desktop\n",
            ),
            (
                "xdg-mime query default x-scheme-handler/https",
                "brave-browser.desktop\n",
            ),
        ]);
        assert_eq!(resolve("linux", &run_command), Some("brave"));
    }

    #[test]
    fn maps_a_windows_userchoice_progid_to_a_browser_id() {
        let output = [
            "",
            "HKEY_CURRENT_USER\\...\\https\\UserChoice",
            "    ProgId    REG_SZ    MSEdgeHTM",
            "",
        ]
        .join("\r\n");
        let run_command = runner_returning(&[(
            "reg query HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice /v ProgId",
            Box::leak(output.into_boxed_str()),
        )]);
        assert_eq!(resolve("win32", &run_command), Some("edge"));
    }

    #[test]
    fn returns_none_when_nothing_matches_or_the_tool_fails() {
        let failing: RunCommand = Arc::new(|_command: &str, _args: &[&str], _env: &Environment| {
            Err(anyhow::anyhow!("no xdg"))
        });
        assert_eq!(resolve("linux", &failing), None);

        let empty: RunCommand =
            Arc::new(|_command: &str, _args: &[&str], _env: &Environment| Ok(String::new()));
        assert_eq!(resolve("sunos", &empty), None);
    }

    #[test]
    fn parses_handler_blocks_and_progid_lines_directly() {
        assert_eq!(
            parse_mac_launch_services_handler(
                "{ LSHandlerURLScheme = https; LSHandlerRoleAll = \"com.brave.browser\"; }"
            ),
            Some("com.brave.browser".to_string())
        );
        assert_eq!(
            parse_windows_prog_id("  ProgId   REG_SZ   FirefoxHTML"),
            Some("FirefoxHTML".to_string())
        );
        assert_eq!(
            browser_for_identifier("COM.GOOGLE.CHROME", "darwin"),
            Some("chrome")
        );
        assert_eq!(browser_for_identifier("", "darwin"), None);
    }
}
