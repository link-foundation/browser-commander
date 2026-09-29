//! Open a URL with the operating system's default browser, without automation.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::utilities::subprocess::{run_command, RunCommandOptions};

const ALLOWED_SCHEMES: [&str; 8] = [
    "http",
    "https",
    "file",
    "ftp",
    "about",
    "chrome",
    "edge",
    "view-source",
];

/// The URL handed to the system browser and the exact opener invocation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpenInUserBrowserResult {
    pub opened: String,
    pub command: Vec<String>,
}

/// Validate that an opener will receive a web URL rather than a command option.
pub fn validate_open_url(url: &str) -> Result<&str> {
    if url.is_empty() {
        return Err(anyhow!("open_in_user_browser requires a URL string"));
    }
    if url.starts_with('-') {
        return Err(anyhow!(
            "Refusing to open {url:?}: a URL cannot start with '-'"
        ));
    }
    let parsed = Url::parse(url)
        .map_err(|_| anyhow!("Refusing to open {url:?}: it is not a valid absolute URL"))?;
    if !ALLOWED_SCHEMES.contains(&parsed.scheme()) {
        return Err(anyhow!(
            "Refusing to open {url:?}: {} is not an allowed web scheme",
            parsed.scheme()
        ));
    }
    Ok(url)
}

/// Build the platform opener's argv. The URL is always the last argument.
pub fn build_open_command(url: &str, platform: &str) -> Result<Vec<String>> {
    validate_open_url(url)?;
    let mut command = match platform {
        "linux" => vec!["xdg-open".to_string()],
        "macos" | "darwin" => vec!["open".to_string()],
        "windows" | "win32" => vec!["explorer.exe".to_string()],
        _ => {
            return Err(anyhow!(
                "open_in_user_browser is not supported on {platform}"
            ))
        }
    };
    command.push(url.to_string());
    Ok(command)
}

/// Show a URL in the user's default browser; no CDP port or profile is made.
pub async fn open_in_user_browser(url: &str) -> Result<OpenInUserBrowserResult> {
    let command = build_open_command(url, std::env::consts::OS)?;
    run_command(&command[0], &command[1..], RunCommandOptions::default()).await?;
    Ok(OpenInUserBrowserResult {
        opened: url.to_string(),
        command,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // feature-parity: attach.open@native-typed
    #[test]
    fn builds_each_system_opener_without_a_shell() {
        assert_eq!(
            build_open_command("https://example.com/", "linux").unwrap(),
            ["xdg-open", "https://example.com/"]
        );
        assert_eq!(
            build_open_command("https://example.com/", "darwin").unwrap(),
            ["open", "https://example.com/"]
        );
        assert_eq!(
            build_open_command("https://example.com/", "win32").unwrap(),
            ["explorer.exe", "https://example.com/"]
        );
        assert_eq!(
            build_open_command("https://example.com/?a=1&b=2", "win32").unwrap(),
            ["explorer.exe", "https://example.com/?a=1&b=2"]
        );
    }

    #[test]
    fn rejects_non_web_schemes_and_options() {
        assert!(validate_open_url("javascript:alert(1)").is_err());
        assert!(validate_open_url("--version").is_err());
        assert!(validate_open_url("not a url").is_err());
    }
}
