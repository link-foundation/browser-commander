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
    let mut args = options.args.clone();
    let key = match options.browser {
        WebDriverBrowser::Chrome => "goog:chromeOptions",
        WebDriverBrowser::Firefox => "moz:firefoxOptions",
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
