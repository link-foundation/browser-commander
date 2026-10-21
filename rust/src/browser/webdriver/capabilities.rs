use super::{WebDriverBrowser, WebDriverOptions};
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::Path;

/// Build W3C capabilities while preserving caller extensions. Managed profile,
/// downloads and BiDi values are authoritative, so an override cannot silently
/// redirect files away from their watcher or abandon the owned profile.
pub fn build_capabilities(
    options: &WebDriverOptions,
    profile: &Path,
    staging: Option<&Path>,
) -> Result<serde_json::Map<String, Value>> {
    let mut preferences = options
        .preferences
        .as_object()
        .cloned()
        .ok_or_else(|| anyhow!("WebDriver preferences must be an object"))?;
    let mut caps = options.capabilities.clone();
    if options.browser.is_safari() {
        use crate::browser::safari::unsupported;
        for (feature, requested) in [
            ("headless", options.headless),
            ("persistent profile", options.user_data_dir.is_some()),
            ("browser arguments", !options.args.is_empty()),
            (
                "preferences",
                !preferences.is_empty() || options.local_state != json!({}),
            ),
            (
                "browser executable (use driver_executable)",
                options.browser_executable.is_some(),
            ),
            (
                "managed downloads",
                !matches!(options.downloads, crate::downloads::DownloadSetting::Off),
            ),
            (
                "first-run settings",
                options.first_run || options.default_browser_check == Some(true),
            ),
        ] {
            if requested {
                return Err(unsupported(feature).into());
            }
        }
        for key in ["goog:chromeOptions", "moz:firefoxOptions", "webSocketUrl"] {
            if caps.contains_key(key) {
                return Err(unsupported(key).into());
            }
        }
        caps.insert(
            "browserName".into(),
            json!(
                if options.browser == WebDriverBrowser::SafariTechnologyPreview {
                    "Safari Technology Preview"
                } else {
                    "safari"
                }
            ),
        );
        return Ok(caps);
    }
    let mut args = options.args.clone();
    let key = match options.browser {
        WebDriverBrowser::Chrome => "goog:chromeOptions",
        WebDriverBrowser::Firefox => "moz:firefoxOptions",
        _ => unreachable!("Safari capabilities returned above"),
    };
    let mut vendor = match caps.remove(key) {
        Some(Value::Object(options)) => options,
        Some(_) => return Err(anyhow!("{key} must be an object")),
        None => Default::default(),
    };
    if let Some(extra) = vendor.remove("args") {
        let extra: Vec<String> = serde_json::from_value(extra)?;
        args.extend(extra);
    }
    if let Some(extra) = vendor.remove("prefs") {
        let Value::Object(extra) = extra else {
            return Err(anyhow!("{key}.prefs must be an object"));
        };
        for (key, value) in extra {
            preferences.entry(key).or_insert(value);
        }
    }
    match options.browser {
        WebDriverBrowser::Chrome => {
            if options.automation_parity {
                let mut excluded: Vec<String> = vendor
                    .remove("excludeSwitches")
                    .map(serde_json::from_value)
                    .transpose()?
                    .unwrap_or_default();
                // Same measured ChromeDriver layer as the JavaScript launcher.
                for name in [
                    "allow-pre-commit-input",
                    "disable-background-networking",
                    "disable-background-timer-throttling",
                    "disable-backgrounding-occluded-windows",
                    "disable-client-side-phishing-detection",
                    "disable-default-apps",
                    "disable-features",
                    "disable-hang-monitor",
                    "disable-popup-blocking",
                    "disable-prompt-on-repost",
                    "disable-sync",
                    "enable-automation",
                    "enable-logging",
                    "log-level",
                    "no-first-run",
                    "no-service-autorun",
                    "password-store",
                    "test-type",
                    "use-mock-keychain",
                ] {
                    if !excluded.iter().any(|value| value == name) {
                        excluded.push(name.into());
                    }
                }
                vendor.insert("excludeSwitches".into(), json!(excluded));
            }
            if args
                .iter()
                .any(|arg| arg.trim_start_matches('-').starts_with("user-data-dir"))
            {
                return Err(anyhow!(
                    "set user_data_dir instead of a Chrome profile argument"
                ));
            }
            args.push(format!("--user-data-dir={}", profile.display()));
            if options.headless {
                args.push("--headless=new".into());
            }
            if !options.sandbox {
                args.push("--no-sandbox".into());
            }
            if let Some(path) = staging {
                preferences.insert("download.default_directory".into(), json!(path));
                preferences.insert("download.prompt_for_download".into(), json!(false));
                preferences.insert("download.directory_upgrade".into(), json!(true));
            }
            caps.insert("browserName".into(), json!("chrome"));
        }
        WebDriverBrowser::Firefox => {
            if vendor.contains_key("profile") {
                return Err(anyhow!(
                    "set user_data_dir instead of moz:firefoxOptions.profile"
                ));
            }
            if args.iter().any(|arg| {
                matches!(arg.as_str(), "-profile" | "--profile") || arg.starts_with("--profile=")
            }) {
                return Err(anyhow!(
                    "set user_data_dir instead of a Firefox profile argument"
                ));
            }
            args.extend(["-profile".into(), profile.to_string_lossy().into_owned()]);
            if options.headless {
                args.push("-headless".into());
            }
            if let Some(path) = staging {
                preferences.insert("browser.download.dir".into(), json!(path));
                preferences.insert("browser.download.folderList".into(), json!(2));
                preferences.insert("browser.download.useDownloadDir".into(), json!(true));
                preferences
                    .entry("browser.helperApps.neverAsk.saveToDisk")
                    .or_insert(json!(
                    "application/octet-stream,text/plain,application/pdf,text/csv,application/zip"
                ));
                preferences.insert("pdfjs.disabled".into(), json!(true));
            }
            caps.insert("browserName".into(), json!("firefox"));
        }
        _ => unreachable!("Safari capabilities returned above"),
    }
    vendor.insert("args".into(), json!(args));
    vendor.insert("prefs".into(), json!(preferences));
    if let Some(binary) = &options.browser_executable {
        vendor.insert("binary".into(), json!(binary));
    }
    caps.insert(key.into(), json!(vendor));
    if options.bidi {
        caps.insert("webSocketUrl".into(), json!(true));
    }
    Ok(caps)
}

/// Put the default restrictions of the Chrome binary before the caller's
/// arguments, environment and preferences, and return them (issue #179):
/// the `chrome-for-testing` preset when `browser_executable` is Chrome for
/// Testing, or `default_restrictions` when the caller chose them. Other
/// browsers get none.
pub(crate) fn apply_default_restrictions(options: &mut WebDriverOptions) -> Result<Vec<String>> {
    use crate::browser::restrictions::{merge_preferences, resolve_restrictions};
    if options.browser != WebDriverBrowser::Chrome {
        return Ok(Vec::new());
    }
    let defaults = match &options.browser_executable {
        Some(executable) => crate::browser::chrome_for_testing::default_restrictions_for(
            executable,
            options.default_restrictions.as_deref(),
        ),
        None => options.default_restrictions.clone().unwrap_or_default(),
    };
    if defaults.is_empty() {
        return Ok(defaults);
    }
    let resolved = resolve_restrictions(&defaults)?;
    options.args = resolved
        .args
        .into_iter()
        .chain(std::mem::take(&mut options.args))
        .collect();
    if resolved
        .preferences
        .as_object()
        .is_some_and(|preferences| !preferences.is_empty())
        && options.preferences.is_object()
    {
        let mut preferences = resolved.preferences;
        merge_preferences(&mut preferences, &options.preferences);
        options.preferences = preferences;
    }
    if !resolved.env.is_empty() {
        let mut env = resolved.env;
        env.extend(options.env.take().unwrap_or_default());
        options.env = Some(env);
    }
    Ok(defaults)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn chrome_for_testing_gets_its_defaults_before_the_callers_arguments() {
        let mut options = WebDriverOptions {
            browser_executable: Some(PathBuf::from(
                "/home/user/.cache/selenium/chrome/linux64/131.0.6778.204/chrome",
            )),
            args: vec!["--lang=de".into()],
            ..Default::default()
        };
        let defaults = apply_default_restrictions(&mut options).unwrap();
        assert_eq!(defaults, ["no-chrome-for-testing-infobar", "mock-keychain"]);
        assert_eq!(
            options.args,
            ["--test-type=gpu", "--use-mock-keychain", "--lang=de"]
        );
        let caps = build_capabilities(&options, Path::new("profile"), None).unwrap();
        let args = caps["goog:chromeOptions"]["args"].as_array().unwrap();
        assert!(args.contains(&json!("--test-type=gpu")));
    }

    #[test]
    fn google_chrome_and_an_opt_out_get_no_defaults() {
        for options in [
            WebDriverOptions {
                browser_executable: Some(PathBuf::from("/usr/bin/google-chrome")),
                ..Default::default()
            },
            WebDriverOptions {
                browser_executable: Some(PathBuf::from(
                    "/home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
                )),
                default_restrictions: Some(Vec::new()),
                ..Default::default()
            },
        ] {
            let mut options = options;
            assert!(apply_default_restrictions(&mut options).unwrap().is_empty());
            assert!(options.args.is_empty());
        }
    }

    #[test]
    fn unknown_default_restrictions_are_refused() {
        let mut options = WebDriverOptions {
            default_restrictions: Some(vec!["no-such-restriction".into()]),
            ..Default::default()
        };
        assert!(apply_default_restrictions(&mut options).is_err());
    }
}
