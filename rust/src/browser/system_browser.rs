//! Discovery of installed Chrome-family browsers and their default profiles.
//!
//! Mirrors `js/src/browser/system-browser.js`. Split out of `real_browser`
//! so the launcher itself stays small.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Return Browser Commander's managed dedicated profile for a channel.
///
/// Launches no longer use it on their own (issue #103: a fresh temporary
/// profile is the default); pass it as `user_data_dir` to keep a persistent
/// profile between runs.
pub fn default_real_browser_user_data_dir(channel: &str) -> PathBuf {
    let directory_name: String = channel
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || "_.-".contains(character) {
                character
            } else {
                '-'
            }
        })
        .collect();
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".browser-commander")
        .join("real-browser")
        .join(directory_name)
}

/// Default user data directories of the installed browsers on this platform.
///
/// Chrome 136 and newer ignore remote-debugging switches for these, and a
/// person's everyday profile is never meant to be exposed over CDP.
pub fn known_default_user_data_dirs() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "macos")]
    {
        let support = home.join("Library").join("Application Support");
        return vec![
            support.join("Google/Chrome"),
            support.join("Google/Chrome Beta"),
            support.join("Google/Chrome Canary"),
            support.join("Google/Chrome Dev"),
            support.join("Chromium"),
            support.join("BraveSoftware/Brave-Browser"),
            support.join("BraveSoftware/Brave-Browser-Beta"),
            support.join("BraveSoftware/Brave-Browser-Nightly"),
            support.join("Microsoft Edge"),
            support.join("Microsoft Edge Beta"),
            support.join("Microsoft Edge Canary"),
            support.join("Microsoft Edge Dev"),
        ];
    }

    #[cfg(target_os = "windows")]
    {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Local"));
        return vec![
            local.join("Google/Chrome/User Data"),
            local.join("Google/Chrome Beta/User Data"),
            local.join("Google/Chrome Dev/User Data"),
            local.join("Google/Chrome SxS/User Data"),
            local.join("Chromium/User Data"),
            local.join("BraveSoftware/Brave-Browser/User Data"),
            local.join("BraveSoftware/Brave-Browser-Beta/User Data"),
            local.join("BraveSoftware/Brave-Browser-Nightly/User Data"),
            local.join("Microsoft/Edge/User Data"),
            local.join("Microsoft/Edge Beta/User Data"),
            local.join("Microsoft/Edge Dev/User Data"),
            local.join("Microsoft/Edge SxS/User Data"),
        ];
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        vec![
            home.join(".config/google-chrome"),
            home.join(".config/google-chrome-beta"),
            home.join(".config/google-chrome-unstable"),
            home.join(".config/chromium"),
            home.join(".config/BraveSoftware/Brave-Browser"),
            home.join(".config/BraveSoftware/Brave-Browser-Beta"),
            home.join(".config/BraveSoftware/Brave-Browser-Nightly"),
            home.join(".config/microsoft-edge"),
            home.join(".config/microsoft-edge-beta"),
            home.join(".config/microsoft-edge-dev"),
        ]
    }
}

fn normalize_for_comparison(path: &Path) -> PathBuf {
    let normalized = std::fs::canonicalize(path).unwrap_or_else(|_| {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .unwrap_or_else(|_| PathBuf::from("."))
                .join(path)
        }
    });

    #[cfg(target_os = "windows")]
    {
        return PathBuf::from(normalized.to_string_lossy().to_lowercase());
    }

    #[cfg(not(target_os = "windows"))]
    {
        normalized
    }
}

/// Ensure Chrome is not asked to expose a known default profile over CDP.
pub fn assert_dedicated_user_data_dir(user_data_dir: &Path) -> Result<(), anyhow::Error> {
    let requested = normalize_for_comparison(user_data_dir);
    if known_default_user_data_dirs()
        .iter()
        .any(|default| normalize_for_comparison(default) == requested)
    {
        return Err(anyhow::anyhow!(
            "launch_real_browser requires a dedicated user_data_dir, not a browser default profile"
        ));
    }
    Ok(())
}

fn channel_executable_names(channel: &str) -> Result<&'static [&'static str], anyhow::Error> {
    match channel {
        "brave" => Ok(&["brave-browser", "brave-browser-stable", "brave"]),
        "chrome" => Ok(&["google-chrome", "google-chrome-stable", "chrome"]),
        "chrome-beta" => Ok(&["google-chrome-beta"]),
        "chrome-canary" => Ok(&["google-chrome-canary"]),
        "chrome-dev" => Ok(&["google-chrome-unstable"]),
        "chromium" => Ok(&["chromium", "chromium-browser"]),
        "msedge" => Ok(&["microsoft-edge", "microsoft-edge-stable", "msedge"]),
        "msedge-beta" => Ok(&["microsoft-edge-beta"]),
        "msedge-canary" => Ok(&["microsoft-edge-canary"]),
        "msedge-dev" => Ok(&["microsoft-edge-dev"]),
        _ => Err(anyhow::anyhow!(
            "unknown browser channel: {channel}; expected chrome, chrome-beta, chrome-canary, chrome-dev, chromium, brave, msedge, msedge-beta, msedge-canary, or msedge-dev"
        )),
    }
}

fn browser_install_candidates(channel: &str) -> Result<Vec<PathBuf>, anyhow::Error> {
    let names = channel_executable_names(channel)?;
    let mut candidates = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let relative = match channel {
            "brave" => "Brave Browser.app/Contents/MacOS/Brave Browser",
            "chrome" => "Google Chrome.app/Contents/MacOS/Google Chrome",
            "chrome-beta" => "Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
            "chrome-canary" => "Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "chrome-dev" => "Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
            "chromium" => "Chromium.app/Contents/MacOS/Chromium",
            "msedge" => "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "msedge-beta" => "Microsoft Edge Beta.app/Contents/MacOS/Microsoft Edge Beta",
            "msedge-canary" => "Microsoft Edge Canary.app/Contents/MacOS/Microsoft Edge Canary",
            "msedge-dev" => "Microsoft Edge Dev.app/Contents/MacOS/Microsoft Edge Dev",
            _ => unreachable!("channel was validated above"),
        };
        candidates.push(Path::new("/Applications").join(relative));
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join("Applications").join(relative));
        }
    }

    #[cfg(target_os = "windows")]
    {
        let relative: &[&str] = match channel {
            "brave" => &["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
            "chrome" => &["Google", "Chrome", "Application", "chrome.exe"],
            "chrome-beta" => &["Google", "Chrome Beta", "Application", "chrome.exe"],
            "chrome-canary" => &["Google", "Chrome SxS", "Application", "chrome.exe"],
            "chrome-dev" => &["Google", "Chrome Dev", "Application", "chrome.exe"],
            "chromium" => &["Chromium", "Application", "chrome.exe"],
            "msedge" => &["Microsoft", "Edge", "Application", "msedge.exe"],
            "msedge-beta" => &["Microsoft", "Edge Beta", "Application", "msedge.exe"],
            "msedge-canary" => &["Microsoft", "Edge SxS", "Application", "msedge.exe"],
            "msedge-dev" => &["Microsoft", "Edge Dev", "Application", "msedge.exe"],
            _ => unreachable!("channel was validated above"),
        };
        for key in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            if let Some(root) = std::env::var_os(key) {
                let mut candidate = PathBuf::from(root);
                candidate.extend(relative);
                candidates.push(candidate);
            }
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        for name in names {
            candidates.push(Path::new("/usr/bin").join(name));
            candidates.push(Path::new("/usr/local/bin").join(name));
        }
        if channel == "chrome" {
            candidates.push(PathBuf::from("/opt/google/chrome/google-chrome"));
        }
    }

    if let Some(path) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&path) {
            for name in names {
                #[cfg(target_os = "windows")]
                let executable_name = format!("{name}.exe");
                #[cfg(not(target_os = "windows"))]
                let executable_name = (*name).to_string();
                candidates.push(directory.join(executable_name));
            }
        }
    }

    let mut seen = HashSet::new();
    candidates.retain(|candidate| seen.insert(candidate.clone()));
    Ok(candidates)
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }

    #[cfg(not(unix))]
    {
        true
    }
}

/// Resolve a genuine installed Chrome-family browser executable for a
/// channel, or check an explicit executable.
pub fn resolve_browser_executable(
    channel: &str,
    executable_path: Option<&Path>,
) -> Result<PathBuf, anyhow::Error> {
    let candidates = if let Some(executable_path) = executable_path {
        vec![normalize_for_comparison(executable_path)]
    } else {
        browser_install_candidates(channel)?
    };

    for candidate in candidates {
        if is_executable(&candidate) {
            return Ok(candidate);
        }
    }

    if let Some(executable_path) = executable_path {
        Err(anyhow::anyhow!(
            "browser executable is not accessible: {}",
            executable_path.display()
        ))
    } else {
        Err(anyhow::anyhow!(
            "could not find an installed {channel} browser; provide executable_path"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_the_current_platform_default_profiles() {
        for profile in known_default_user_data_dirs() {
            let error = assert_dedicated_user_data_dir(&profile).unwrap_err();
            assert!(error.to_string().contains("dedicated user_data_dir"));
        }
        let dedicated = std::env::temp_dir().join("browser-commander-dedicated");
        assert!(assert_dedicated_user_data_dir(&dedicated).is_ok());
    }

    #[test]
    fn all_required_channels_have_discovery_candidates() {
        for channel in ["chrome", "chromium", "brave", "msedge"] {
            assert!(!browser_install_candidates(channel).unwrap().is_empty());
        }

        let chrome = browser_install_candidates("chrome").unwrap();
        let has_platform_default = if cfg!(target_os = "macos") {
            chrome.contains(&PathBuf::from(
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            ))
        } else if cfg!(target_os = "windows") {
            chrome.iter().any(|candidate| {
                candidate.ends_with(Path::new("Google/Chrome/Application/chrome.exe"))
            })
        } else {
            chrome.contains(&PathBuf::from("/usr/bin/google-chrome"))
        };
        assert!(has_platform_default);
    }

    #[test]
    fn reports_unknown_channels_and_missing_executables() {
        let error = resolve_browser_executable("netscape", None).unwrap_err();
        assert!(
            error.to_string().contains("unknown browser channel"),
            "{error}"
        );
        let error = resolve_browser_executable("chrome", Some(Path::new("/nonexistent/chrome")))
            .unwrap_err();
        assert!(error.to_string().contains("not accessible"), "{error}");
    }
}
