//! A profile directory is permanent storage: all cookies, session ones
//! included, survive restarts (issue #187).
//!
//! Chromium deletes cookies without an expiry date when its profile starts,
//! unless the last exit was a crash or the startup setting is "Continue where
//! you left off" (`ProfileImpl::ShouldRestoreOldSessionCookies`). A normal
//! `close()` is a clean exit, so a persistent profile lost every session login
//! on each restart. [`KEEP_SESSION_COOKIES_SWITCH`] turns that setting on for
//! one launch, and the browser's own encrypted cookie store keeps the cookies;
//! no extra file is written (measured with Chrome for Testing 153 and Google
//! Chrome 155, experiments/issue-187/raw-chrome.mjs). Same module as
//! `js/src/browser/persistent-profile.js`.

use std::path::Path;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

/// The Chromium switch that keeps session cookies of a persistent profile.
pub const KEEP_SESSION_COOKIES_SWITCH: &str = "--restore-last-session";

/// The field trial that makes Chrome for Testing continue the last session by
/// default (`SessionRestoreInfobar.Enabled_ContinueDefault`). It keeps session
/// cookies without any switch, so the explicit opt-out turns it off.
pub const CONTINUE_SESSION_FEATURE: &str = "SessionRestoreInfobar";

/// Firefox keeps session cookies through SessionStore when it restores the
/// previous session at startup ("Open previous windows and tabs"); geckodriver
/// writes `browser.startup.page = 0` otherwise (measured with Firefox 158 and
/// geckodriver 0.37.1, experiments/issue-187/firefox.mjs). The cookies live in
/// the session file, so restored tabs are closed after launch instead of the
/// file being deleted.
pub const FIREFOX_KEEP_SESSION_COOKIES_PREFERENCES: [(&str, i64); 1] =
    [("browser.startup.page", 3)];

/// The files a Chromium profile directory restores the last session's tabs
/// from: `Sessions/` in current releases, the four legacy files before it.
/// Cookies are kept in `Cookies`, so deleting these only drops the tabs.
pub const SESSION_RESTORE_FILES: [&str; 5] = [
    "Sessions",
    "Current Session",
    "Current Tabs",
    "Last Session",
    "Last Tabs",
];

/// A launch-result entry saying session cookies are not kept, and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionCookieWarning {
    /// The option the warning is about: always `keep_session_cookies`.
    pub item: String,
    /// A stable reason, such as `safari-no-profile-directory` or
    /// `headless-shell`.
    pub reason: String,
    /// What happens and what to do instead.
    pub detail: String,
}

impl SessionCookieWarning {
    pub(crate) fn new(reason: &str, detail: &str) -> Self {
        Self {
            item: "keep_session_cookies".into(),
            reason: reason.into(),
            detail: detail.into(),
        }
    }
}

/// Whether a launch keeps session cookies: the caller's choice, otherwise yes
/// for a persistent profile; `None` for a temporary profile without an
/// explicit choice, which keeps today's command line.
pub fn resolve_keep_session_cookies(
    keep_session_cookies: Option<bool>,
    temporary_profile: bool,
) -> Option<bool> {
    keep_session_cookies.or((!temporary_profile).then_some(true))
}

/// The Chromium switches for a persistent profile, for apps that start the
/// browser themselves and attach over CDP. Combine with
/// [`clear_restored_tabs`] to start with one tab.
///
/// `false` asks for Chromium's default of deleting session cookies at
/// startup.
pub fn persistent_profile_args(keep_session_cookies: bool) -> Vec<String> {
    if keep_session_cookies {
        vec![KEEP_SESSION_COOKIES_SWITCH.to_string()]
    } else {
        vec![format!("--disable-features={CONTINUE_SESSION_FEATURE}")]
    }
}

/// The switches for a resolved choice, minus those already in `args`; none
/// when the choice is `None`.
pub(crate) fn session_cookie_args(
    keep_session_cookies: Option<bool>,
    args: &[String],
) -> Vec<String> {
    keep_session_cookies
        .map(persistent_profile_args)
        .unwrap_or_default()
        .into_iter()
        .filter(|argument| !args.contains(argument))
        .collect()
}

/// The `--profile-directory` an argument list selects, `Default` otherwise.
pub(crate) fn profile_directory_from_args(args: &[String]) -> &str {
    args.iter()
        .rev()
        .find_map(|argument| argument.strip_prefix("--profile-directory="))
        .unwrap_or("Default")
}

/// Delete the tabs a Chromium profile would restore, keeping its cookies, so
/// [`KEEP_SESSION_COOKIES_SWITCH`] starts with the start URL only.
///
/// # Errors
///
/// Returns an error when `profile_directory` is not a single directory name,
/// or a file cannot be deleted.
pub fn clear_restored_tabs(user_data_dir: &Path, profile_directory: &str) -> Result<()> {
    if profile_directory.is_empty()
        || matches!(profile_directory, "." | "..")
        || profile_directory.contains(['/', '\\', '\0'])
    {
        return Err(anyhow!(
            "profile_directory must be a directory name such as Default or Profile 1"
        ));
    }
    let profile = user_data_dir.join(profile_directory);
    for name in SESSION_RESTORE_FILES {
        let target = profile.join(name);
        let removed = match std::fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(&target),
            Ok(_) => std::fs::remove_file(&target),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        };
        removed.map_err(|error| anyhow!("cannot delete {}: {error}", target.display()))?;
    }
    Ok(())
}

/// Prepare a Chromium profile for a launch that keeps session cookies: unless
/// `restore_tabs` is set the last session's tabs are deleted first, so the
/// driven tab is the only one.
///
/// # Errors
///
/// See [`clear_restored_tabs`].
pub fn prepare_session_restore(
    user_data_dir: &Path,
    keep_session_cookies: Option<bool>,
    restore_tabs: bool,
    args: &[String],
) -> Result<()> {
    if keep_session_cookies == Some(true) && !restore_tabs {
        clear_restored_tabs(user_data_dir, profile_directory_from_args(args))?;
    }
    Ok(())
}

/// The warning for a Safari launch asked to keep session cookies: safaridriver
/// runs Safari without a profile directory of its own.
pub(crate) fn safari_session_cookie_warnings(
    keep_session_cookies: Option<bool>,
) -> Vec<SessionCookieWarning> {
    if keep_session_cookies == Some(true) {
        vec![SessionCookieWarning::new(
            "safari-no-profile-directory",
            "safaridriver runs Safari in an isolated automation session without a profile directory, so its session cookies end with the session",
        )]
    } else {
        Vec::new()
    }
}

/// Playwright's headless default is chromium-headless-shell, which deletes
/// session cookies at startup even with [`KEEP_SESSION_COOKIES_SWITCH`]; the
/// full Chromium build in new headless mode keeps them (measured with
/// Playwright's chromium-1243, experiments/issue-187/playwright-channel.mjs).
pub(crate) fn playwright_session_channel(
    headless: bool,
    channel: Option<&str>,
    executable_path: Option<&Path>,
) -> Option<String> {
    if headless && channel.is_none() && executable_path.is_none() {
        Some("chromium".into())
    } else {
        channel.map(str::to_owned)
    }
}

/// A warning when the browser is an explicit chromium-headless-shell, which
/// cannot keep session cookies.
pub(crate) fn headless_shell_warnings(
    headless: bool,
    channel: Option<&str>,
    executable_path: Option<&Path>,
) -> Vec<SessionCookieWarning> {
    let executable = executable_path
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    let shell = headless
        && (channel == Some("chromium-headless-shell")
            || executable.contains("headless_shell")
            || executable.contains("headless-shell"));
    if shell {
        vec![SessionCookieWarning::new(
            "headless-shell",
            "chromium-headless-shell deletes session cookies at startup; use the full Chromium build (channel \"chromium\") to keep them",
        )]
    } else {
        Vec::new()
    }
}

#[cfg(test)]
#[path = "persistent_profile_tests.rs"]
mod tests;
