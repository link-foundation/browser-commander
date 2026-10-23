//! Unit tests for [`super`], mirroring
//! `js/tests/unit/browser/persistent-profile.test.js`.
// feature-parity: profile.session-cookies@native-typed

use std::path::PathBuf;

use super::*;
use crate::browser::profile_directory::create_temporary_user_data_dir;

const OPT_OUT: &str = "--disable-features=SessionRestoreInfobar";

/// A fresh profile directory, removed when dropped.
struct Profile(PathBuf);

impl Profile {
    fn new() -> Self {
        Self(create_temporary_user_data_dir(None).unwrap())
    }

    /// Write the files a profile restores tabs from, plus its cookie store.
    fn with_session(self, profile_directory: &str) -> Self {
        let profile = self.0.join(profile_directory);
        std::fs::create_dir_all(profile.join("Sessions")).unwrap();
        std::fs::write(profile.join("Sessions").join("Session_1"), b"tabs").unwrap();
        for name in &SESSION_RESTORE_FILES[1..] {
            std::fs::write(profile.join(name), b"tabs").unwrap();
        }
        std::fs::write(profile.join("Cookies"), b"cookies").unwrap();
        self
    }

    fn has(&self, profile_directory: &str, name: &str) -> bool {
        self.0.join(profile_directory).join(name).exists()
    }
}

impl Drop for Profile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

#[test]
fn persistent_profile_args_keep_session_cookies_or_opt_out() {
    assert_eq!(KEEP_SESSION_COOKIES_SWITCH, "--restore-last-session");
    assert_eq!(
        persistent_profile_args(true),
        strings(&["--restore-last-session"])
    );
    assert_eq!(persistent_profile_args(false), strings(&[OPT_OUT]));
}

#[test]
fn a_persistent_profile_keeps_session_cookies_unless_opted_out() {
    assert_eq!(resolve_keep_session_cookies(None, false), Some(true));
    assert_eq!(
        resolve_keep_session_cookies(Some(false), false),
        Some(false)
    );
    assert_eq!(resolve_keep_session_cookies(Some(true), false), Some(true));
}

#[test]
fn a_temporary_profile_keeps_its_command_line_without_an_explicit_choice() {
    assert_eq!(resolve_keep_session_cookies(None, true), None);
    assert_eq!(resolve_keep_session_cookies(Some(true), true), Some(true));
    assert_eq!(resolve_keep_session_cookies(Some(false), true), Some(false));
    assert!(session_cookie_args(None, &[]).is_empty());
}

#[test]
fn session_cookie_args_skip_switches_the_caller_already_passed() {
    assert_eq!(
        session_cookie_args(Some(true), &strings(&["--lang=en"])),
        strings(&["--restore-last-session"])
    );
    assert!(session_cookie_args(Some(true), &strings(&["--restore-last-session"])).is_empty());
    assert!(session_cookie_args(Some(false), &strings(&[OPT_OUT])).is_empty());
}

#[test]
fn the_profile_directory_comes_from_the_last_switch() {
    assert_eq!(profile_directory_from_args(&[]), "Default");
    assert_eq!(
        profile_directory_from_args(&strings(&[
            "--profile-directory=Profile 1",
            "--lang=en",
            "--profile-directory=Profile 2",
        ])),
        "Profile 2"
    );
}

#[test]
fn clear_restored_tabs_keeps_the_cookie_store() {
    let profile = Profile::new().with_session("Default");
    clear_restored_tabs(&profile.0, "Default").unwrap();
    for name in SESSION_RESTORE_FILES {
        assert!(!profile.has("Default", name), "{name} was not deleted");
    }
    assert!(profile.has("Default", "Cookies"));
    // A second call, with nothing left to delete, succeeds.
    clear_restored_tabs(&profile.0, "Default").unwrap();
}

#[test]
fn clear_restored_tabs_uses_the_selected_profile_directory() {
    let profile = Profile::new()
        .with_session("Default")
        .with_session("Profile 1");
    clear_restored_tabs(&profile.0, "Profile 1").unwrap();
    assert!(!profile.has("Profile 1", "Sessions"));
    assert!(profile.has("Default", "Sessions"));
}

#[test]
fn clear_restored_tabs_rejects_paths() {
    let profile = Profile::new();
    for name in ["", ".", "..", "../Default", "a/b", "a\\b"] {
        let error = clear_restored_tabs(&profile.0, name).unwrap_err();
        assert!(
            error.to_string().contains("directory name"),
            "{name}: {error}"
        );
    }
}

#[test]
fn prepare_session_restore_drops_tabs_only_when_keeping_cookies() {
    let profile = Profile::new().with_session("Default");
    prepare_session_restore(&profile.0, None, false, &[]).unwrap();
    prepare_session_restore(&profile.0, Some(false), false, &[]).unwrap();
    prepare_session_restore(&profile.0, Some(true), true, &[]).unwrap();
    assert!(profile.has("Default", "Sessions"), "tabs kept");

    prepare_session_restore(&profile.0, Some(true), false, &[]).unwrap();
    assert!(!profile.has("Default", "Sessions"));
    assert!(profile.has("Default", "Cookies"));
}

#[test]
fn prepare_session_restore_follows_profile_directory() {
    let profile = Profile::new()
        .with_session("Default")
        .with_session("Profile 1");
    let args = strings(&["--profile-directory=Profile 1"]);
    prepare_session_restore(&profile.0, Some(true), false, &args).unwrap();
    assert!(!profile.has("Profile 1", "Sessions"));
    assert!(profile.has("Default", "Sessions"));
}

#[test]
fn safari_warns_that_it_has_no_profile_directory() {
    assert!(safari_session_cookie_warnings(None).is_empty());
    assert!(safari_session_cookie_warnings(Some(false)).is_empty());
    let warnings = safari_session_cookie_warnings(Some(true));
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].item, "keep_session_cookies");
    assert_eq!(warnings[0].reason, "safari-no-profile-directory");
}

#[test]
fn headless_playwright_uses_the_full_chromium_build() {
    assert_eq!(
        playwright_session_channel(true, None, None).as_deref(),
        Some("chromium")
    );
    assert_eq!(playwright_session_channel(false, None, None), None);
    assert_eq!(
        playwright_session_channel(true, Some("chrome"), None).as_deref(),
        Some("chrome")
    );
    let chrome = Path::new("/usr/bin/google-chrome");
    assert_eq!(playwright_session_channel(true, None, Some(chrome)), None);
}

#[test]
fn an_explicit_headless_shell_gets_a_warning() {
    let warnings = headless_shell_warnings(true, Some("chromium-headless-shell"), None);
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].reason, "headless-shell");
    let shell = Path::new("/cache/chromium_headless_shell-1243/chrome-linux/headless_shell");
    assert_eq!(headless_shell_warnings(true, None, Some(shell)).len(), 1);
    assert!(headless_shell_warnings(false, Some("chromium-headless-shell"), None).is_empty());
    assert!(headless_shell_warnings(true, Some("chromium"), None).is_empty());
}

#[test]
fn warnings_serialize_like_the_other_bindings() {
    let warning = SessionCookieWarning::new("headless-shell", "detail");
    assert_eq!(
        serde_json::to_value(&warning).unwrap(),
        serde_json::json!({"item": "keep_session_cookies", "reason": "headless-shell", "detail": "detail"})
    );
}
