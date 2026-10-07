//! Discovery of installed Chrome-family browsers and their default profiles.
//!
//! Mirrors `js/src/browser/system-browser.js`. Split out of `real_browser`
//! so the launcher itself stays small.

use super::browser_profile_files::physical_path;
use super::browser_profiles::current_platform;
use super::browser_sources::{
    browser_sources, current_environment, find_browser_source, resolve_browser_executables,
    resolve_browser_protection_roots, Environment,
};
use std::path::{Path, PathBuf};

/// Reject known non-CDP families before profile preparation or process launch.
pub(crate) fn assert_cdp_browser(channel: &str) -> Result<(), anyhow::Error> {
    if find_browser_source(channel).is_some_and(|source| source.family != "chromium") {
        return Err(anyhow::anyhow!(
            "{channel} does not support CDP; use its documented WebDriver setup when available"
        ));
    }
    Ok(())
}

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

    known_default_user_data_dirs_for(current_platform(), &home, &current_environment())
}

fn known_default_user_data_dirs_for(
    platform: &str,
    home: &Path,
    environment: &Environment,
) -> Vec<PathBuf> {
    browser_sources()
        .iter()
        .flat_map(|browser| {
            resolve_browser_protection_roots(
                &browser.id,
                platform,
                &home.to_string_lossy(),
                environment,
            )
            .unwrap_or_default()
        })
        .collect()
}

fn normalize_for_comparison(path: &Path) -> Result<PathBuf, anyhow::Error> {
    let normalized = physical_path(path)?;

    #[cfg(target_os = "windows")]
    {
        Ok(PathBuf::from(normalized.to_string_lossy().to_lowercase()))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(normalized)
    }
}

/// Ensure Chrome is not asked to expose a known default profile over CDP.
pub fn assert_dedicated_user_data_dir(user_data_dir: &Path) -> Result<(), anyhow::Error> {
    assert_dedicated_user_data_dir_against(user_data_dir, &known_default_user_data_dirs())
}

fn assert_dedicated_user_data_dir_against(
    user_data_dir: &Path,
    defaults: &[PathBuf],
) -> Result<(), anyhow::Error> {
    let requested = normalize_for_comparison(user_data_dir)?;
    for default in defaults {
        if requested.starts_with(normalize_for_comparison(default)?) {
            return Err(anyhow::anyhow!(
                "launch_real_browser requires a dedicated user_data_dir, not a browser default profile"
            ));
        }
    }
    Ok(())
}

fn browser_install_candidates(channel: &str) -> Result<Vec<PathBuf>, anyhow::Error> {
    let source = find_browser_source(channel)
        .ok_or_else(|| anyhow::anyhow!("unknown browser channel: {channel}"))?;
    if source.executable_names.is_empty() {
        return Err(anyhow::anyhow!(
            "No supported installed executable for {channel}"
        ));
    }
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    resolve_browser_executables(
        channel,
        current_platform(),
        &home.to_string_lossy(),
        &current_environment(),
    )
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
        vec![normalize_for_comparison(executable_path)?]
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
    use crate::browser::browser_sources::resolve_browser_roots;

    #[test]
    fn protection_defaults_to_discovery_roots_for_other_browsers() {
        let environment = Environment::new();
        for browser in browser_sources()
            .iter()
            .filter(|entry| entry.protection_roots.is_none())
        {
            for platform in ["linux", "darwin", "win32"] {
                assert_eq!(
                    resolve_browser_protection_roots(
                        &browser.id,
                        platform,
                        "/users/test",
                        &environment
                    )
                    .unwrap(),
                    resolve_browser_roots(&browser.id, platform, "/users/test", &environment)
                        .unwrap()
                );
            }
        }
    }

    #[test]
    fn accepts_dedicated_macos_application_profiles_under_library() {
        let home = std::env::temp_dir().join("bc-macos-profile-protection");
        let defaults = known_default_user_data_dirs_for("darwin", &home, &Environment::new());
        for directory in [
            "Library/Application Support/package-registry-manager/browser-profile",
            "Library/Safari-backup/profile",
            "Library/Cookies-backup/profile",
            "Library/Containers/com.apple.Safari-helper/profile",
        ] {
            let requested = home.join(directory);
            assert!(
                assert_dedicated_user_data_dir_against(&requested, &defaults).is_ok(),
                "{}",
                requested.display()
            );
        }
    }

    #[test]
    fn protects_safari_stores_and_chrome_profiles_on_macos() {
        let home = std::env::temp_dir().join("bc-macos-profile-protection");
        let defaults = known_default_user_data_dirs_for("darwin", &home, &Environment::new());
        for directory in [
            "Library/Safari",
            "Library/Cookies",
            "Library/Containers/com.apple.Safari",
            "Library/Safari Technology Preview",
            "Library/Containers/com.apple.SafariTechnologyPreview",
            "Library/Application Support/Google/Chrome/Default",
        ] {
            let root = home.join(directory);
            for requested in [&root, &root.join("new-profile")] {
                let error =
                    assert_dedicated_user_data_dir_against(requested, &defaults).unwrap_err();
                assert!(error.to_string().contains("dedicated user_data_dir"));
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn normalizes_new_profiles_beneath_symlinks() {
        let root = crate::browser::create_temporary_user_data_dir(None).unwrap();
        let actual = root.join("default-profile");
        std::fs::create_dir(&actual).unwrap();
        let alias = root.join("profile-alias");
        std::os::unix::fs::symlink(&actual, &alias).unwrap();
        assert_eq!(
            normalize_for_comparison(&alias.join("new-profile")).unwrap(),
            actual.canonicalize().unwrap().join("new-profile")
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_the_current_platform_default_profiles() {
        for profile in known_default_user_data_dirs() {
            let error = assert_dedicated_user_data_dir(&profile).unwrap_err();
            assert!(error.to_string().contains("dedicated user_data_dir"));
            assert!(assert_dedicated_user_data_dir(&profile.join("Profile 1")).is_err());
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

    #[test]
    fn derives_all_platform_executables_and_aliases_from_the_catalogue() {
        let env = Environment::from([
            ("LOCALAPPDATA".into(), "C:\\Local".into()),
            ("PROGRAMFILES".into(), "C:\\Programs".into()),
        ]);
        for browser in browser_sources()
            .iter()
            .filter(|entry| entry.family == "chromium")
        {
            assert!(!browser.executable_names.is_empty(), "{}", browser.id);
            for alias in &browser.aliases {
                assert_eq!(
                    find_browser_source(alias).unwrap().executable_names,
                    browser.executable_names
                );
            }
            for platform in browser.roots.keys() {
                assert!(
                    !resolve_browser_executables(&browser.id, platform, "/test", &env)
                        .unwrap()
                        .is_empty(),
                    "{} {platform}",
                    browser.id
                );
            }
        }
        assert!(
            resolve_browser_executables("opera", "win32", "C:\\User", &env)
                .unwrap()
                .contains(&PathBuf::from("C:\\Local\\Programs\\Opera\\opera.exe"))
        );
    }
}
