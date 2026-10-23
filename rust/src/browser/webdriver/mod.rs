//! Managed ChromeDriver/geckodriver through command-stream, with typed Fantoccini
//! sessions, portable managed downloads and optional native WebDriver BiDi.

mod adapter;
pub mod bidi;
mod capabilities;
mod snapshot;
mod storage;
pub use snapshot::{launch_webdriver_snapshot, WebDriverSnapshotResult};

pub use capabilities::build_capabilities;
pub use fantoccini::{Client as WebDriverClient, Locator};

use crate::{
    browser::persistent_profile::{
        prepare_session_restore, resolve_keep_session_cookies, safari_session_cookie_warnings,
        session_cookie_args, SessionCookieWarning, FIREFOX_KEEP_SESSION_COOKIES_PREFERENCES,
    },
    browser::profile_directory::{
        create_temporary_user_data_dir_with_first_run, remove_user_data_dir,
    },
    downloads::{normalize_download_options, DownloadManager, DownloadSetting},
    utilities::{start_process, ManagedProcess, StartProcessOptions},
};
use anyhow::{anyhow, Context, Result};
use bidi::BidiClient;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{
    net::TcpStream,
    sync::OnceCell,
    time::{sleep, timeout},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum WebDriverBrowser {
    #[default]
    Chrome,
    Firefox,
    Safari,
    SafariTechnologyPreview,
}

impl WebDriverBrowser {
    pub fn is_safari(self) -> bool {
        matches!(self, Self::Safari | Self::SafariTechnologyPreview)
    }
}

#[derive(Clone, Debug)]
pub struct WebDriverOptions {
    pub browser: WebDriverBrowser,
    /// Matching chromedriver/geckodriver; otherwise the chromedriver
    /// downloaded with a Chrome for Testing `browser_executable` (issue
    /// #179), else resolved through PATH.
    pub driver_executable: Option<PathBuf>,
    pub browser_executable: Option<PathBuf>,
    /// An existing dedicated profile is retained on close. Never use a profile
    /// that is already open in another browser.
    pub user_data_dir: Option<PathBuf>,
    pub headless: bool,
    pub sandbox: bool,
    pub args: Vec<String>,
    pub preferences: Value,
    pub local_state: Value,
    pub default_browser_check: Option<bool>,
    pub first_run: bool,
    pub automation_parity: bool,
    pub capabilities: serde_json::Map<String, Value>,
    /// Added to the driver and inherited by its browser; parent stays unchanged.
    pub env: Option<HashMap<String, String>>,
    pub downloads: DownloadSetting,
    pub launch_timeout: Duration,
    /// Request webSocketUrl and connect when the driver supplies it.
    pub bidi: bool,
    /// Chrome restrictions added before `args` (issue #179). `None` picks
    /// them from `browser_executable`: the `chrome-for-testing` preset for
    /// Chrome for Testing, nothing otherwise. `Some(vec![])` opts out.
    pub default_restrictions: Option<Vec<String>>,
    /// Keep session cookies across restarts: `None` keeps them with
    /// `user_data_dir` and leaves a temporary profile untouched (issue #187).
    /// Chrome gets `--restore-last-session`, Firefox restores its previous
    /// session, and Safari reports a warning.
    pub keep_session_cookies: Option<bool>,
    /// With session cookies kept, also reopen the last session's tabs.
    pub restore_tabs: bool,
}

impl Default for WebDriverOptions {
    fn default() -> Self {
        Self {
            browser: WebDriverBrowser::Chrome,
            driver_executable: None,
            browser_executable: None,
            user_data_dir: None,
            headless: false,
            sandbox: true,
            args: Vec::new(),
            preferences: json!({}),
            local_state: json!({}),
            default_browser_check: None,
            first_run: false,
            automation_parity: true,
            capabilities: Default::default(),
            env: None,
            downloads: DownloadSetting::Off,
            launch_timeout: Duration::from_secs(30),
            bidi: true,
            default_restrictions: None,
            keep_session_cookies: None,
            restore_tabs: false,
        }
    }
}

struct OwnedDriver {
    child: Option<Arc<ManagedProcess>>,
    profile: PathBuf,
    temporary: bool,
}

impl OwnedDriver {
    async fn stop(&mut self) -> Result<()> {
        if let Some(child) = self.child.take() {
            child.kill();
            child.wait_timeout(Duration::from_secs(6)).await;
        }
        if self.temporary {
            remove_user_data_dir(&self.profile).await?;
        }
        Ok(())
    }
}

impl Drop for OwnedDriver {
    fn drop(&mut self) {
        let profile = self.profile.clone();
        let temporary = self.temporary;
        if let Some(child) = self.child.take() {
            child.kill();
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    child.wait_timeout(Duration::from_secs(6)).await;
                    if temporary {
                        let _ = remove_user_data_dir(&profile).await;
                    }
                });
                return;
            }
        }
        if temporary {
            let _ = std::fs::remove_dir_all(profile);
        }
    }
}

/// Owns driver, browser session, BiDi and the optional download watcher.
/// All typed Fantoccini APIs are available through [`Self::client`]. Close
/// waits for downloads before quitting; Drop stops the owned driver as well.
pub struct ManagedWebDriver {
    browser: WebDriverBrowser,
    client: WebDriverClient,
    bidi: Option<Arc<BidiClient>>,
    downloads: Option<Arc<DownloadManager>>,
    profile: PathBuf,
    default_restrictions: Vec<String>,
    keep_session_cookies: bool,
    warnings: Vec<SessionCookieWarning>,
    driver: tokio::sync::Mutex<OwnedDriver>,
    closed: OnceCell<()>,
}

impl ManagedWebDriver {
    pub fn client(&self) -> &WebDriverClient {
        &self.client
    }
    pub fn bidi(&self) -> Option<&Arc<BidiClient>> {
        self.bidi.as_ref()
    }
    pub fn downloads(&self) -> Option<&Arc<DownloadManager>> {
        self.downloads.as_ref()
    }
    pub fn user_data_dir(&self) -> &Path {
        &self.profile
    }
    /// Restrictions the launch added before the caller's arguments, such as
    /// the `chrome-for-testing` preset for Chrome for Testing.
    pub fn default_restrictions(&self) -> &[String] {
        &self.default_restrictions
    }
    /// Whether session cookies survive a restart of this profile.
    pub fn keep_session_cookies(&self) -> bool {
        self.keep_session_cookies
    }
    /// Why session cookies are not kept where they were asked for.
    pub fn warnings(&self) -> &[SessionCookieWarning] {
        &self.warnings
    }
    pub fn driver_pid(&self) -> Option<u32> {
        self.driver
            .try_lock()
            .ok()
            .and_then(|driver| driver.child.as_ref().and_then(|child| child.pid()))
    }
    pub(crate) fn process_handle(&self) -> crate::browser::browser_process::BrowserProcess {
        let child = self
            .driver
            .try_lock()
            .expect("new driver is unlocked")
            .child
            .as_ref()
            .unwrap()
            .clone();
        crate::browser::browser_process::BrowserProcess::from_control(child)
    }
    /// Reject unsupported Safari features before starting an operation.
    pub fn require_feature(&self, feature: &str) -> Result<(), crate::core::engine::EngineError> {
        if self.browser.is_safari() {
            Err(crate::browser::safari::unsupported(feature))
        } else {
            Ok(())
        }
    }
    pub async fn close(&self) -> Result<()> {
        self.closed
            .get_or_try_init(|| async {
                if let Some(manager) = &self.downloads {
                    manager.dispose().await;
                }
                if let Some(bidi) = &self.bidi {
                    bidi.close().await;
                }
                // Even a dead session must release its driver and copied profile.
                let result = timeout(Duration::from_secs(6), self.client.clone().close()).await;
                self.driver.lock().await.stop().await?;
                if let Ok(Err(error)) = result {
                    tracing::debug!(%error, "WebDriver session was already closed");
                }
                Ok::<(), anyhow::Error>(())
            })
            .await
            .map(|_| ())
    }
}

impl Drop for ManagedWebDriver {
    fn drop(&mut self) {
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let manager = self.downloads.take();
            let bidi = self.bidi.take();
            runtime.spawn(async move {
                if let Some(manager) = manager {
                    manager.dispose().await;
                }
                if let Some(bidi) = bidi {
                    bidi.close().await;
                }
            });
        }
    }
}

/// The driver a launch starts: the requested one, else for Chrome for
/// Testing a cached chromedriver of its release - a `chromedriver` on `PATH`
/// belongs to the installed Google Chrome and refuses another release (issue
/// #179) - else the driver on `PATH`.
fn driver_executable(options: &WebDriverOptions) -> PathBuf {
    if let Some(driver) = &options.driver_executable {
        return driver.clone();
    }
    if options.browser == WebDriverBrowser::Chrome {
        if let Some(driver) = options
            .browser_executable
            .as_deref()
            .and_then(crate::browser::chrome_for_testing::chromedriver_for)
        {
            return driver;
        }
    }
    PathBuf::from(match options.browser {
        WebDriverBrowser::Chrome => "chromedriver",
        WebDriverBrowser::Firefox => "geckodriver",
        WebDriverBrowser::Safari => "/usr/bin/safaridriver",
        WebDriverBrowser::SafariTechnologyPreview => {
            "/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver"
        }
    })
}

/// Firefox restores the previous session's tabs together with its session
/// cookies, before the WebDriver session starts. Close all but one and start
/// it blank, so one tab is driven as before.
async fn start_driven_tab(client: &WebDriverClient) -> Result<()> {
    let mut handles = client.windows().await?.into_iter();
    let Some(kept) = handles.next() else {
        return Ok(());
    };
    for handle in handles {
        client.switch_to_window(handle).await?;
        client.close_window().await?;
    }
    client.switch_to_window(kept).await?;
    client.goto("about:blank").await?;
    Ok(())
}

/// Start a locally installed driver. No npm package or Node process is used.
pub async fn launch_webdriver(options: WebDriverOptions) -> Result<ManagedWebDriver> {
    launch_owned(options, false, None).await
}

/// [`launch_webdriver`] in a profile the caller created and deletes:
/// `temporary_profile` says whether it is temporary, which decides the
/// default of `keep_session_cookies`.
pub(crate) async fn launch_webdriver_in_profile(
    options: WebDriverOptions,
    temporary_profile: bool,
) -> Result<ManagedWebDriver> {
    launch_owned(options, false, Some(temporary_profile)).await
}

async fn launch_owned(
    mut options: WebDriverOptions,
    own_profile: bool,
    temporary_profile: Option<bool>,
) -> Result<ManagedWebDriver> {
    if options.launch_timeout.is_zero() {
        return Err(anyhow!("launch_timeout must be positive"));
    }
    let default_restrictions = capabilities::apply_default_restrictions(&mut options)?;
    // Validate before creating profiles or starting a process.
    build_capabilities(&options, Path::new("validation-profile"), None)?;
    let safari = options.browser.is_safari();
    if safari && !cfg!(target_os = "macos") && options.driver_executable.is_none() {
        return Err(crate::browser::safari::unsupported("Safari launch outside macOS").into());
    }
    let temporary = !safari && (own_profile || options.user_data_dir.is_none());
    let (keep_session_cookies, warnings) = if safari {
        (
            None,
            safari_session_cookie_warnings(options.keep_session_cookies),
        )
    } else {
        (
            resolve_keep_session_cookies(
                options.keep_session_cookies,
                temporary_profile.unwrap_or(temporary),
            ),
            Vec::new(),
        )
    };
    if options.browser == WebDriverBrowser::Chrome {
        let switches = session_cookie_args(keep_session_cookies, &options.args);
        if !switches.is_empty() {
            options.args.extend(switches);
            // One --disable-features switch: Chrome reads only the last.
            options.args = crate::browser::restrictions::merge_feature_switches(&options.args);
        }
    }
    if options.browser == WebDriverBrowser::Firefox && keep_session_cookies == Some(true) {
        if let Some(preferences) = options.preferences.as_object_mut() {
            for (name, value) in FIREFOX_KEEP_SESSION_COOKIES_PREFERENCES {
                preferences.insert(name.into(), json!(value));
            }
        }
    }
    let profile = if safari {
        PathBuf::new()
    } else {
        match &options.user_data_dir {
            Some(path) => {
                std::fs::create_dir_all(path)?;
                std::fs::canonicalize(path)?
            }
            None => create_temporary_user_data_dir_with_first_run(None, options.first_run)?,
        }
    };
    let mut owner = OwnedDriver {
        child: None,
        profile: profile.clone(),
        temporary,
    };
    if options.browser == WebDriverBrowser::Chrome {
        use crate::browser::profile_directory::{
            configure_user_data_dir_for_profile, prepare_user_data_dir_with_first_run,
        };
        prepare_user_data_dir_with_first_run(&profile, options.first_run)?;
        let selected = options
            .args
            .iter()
            .find_map(|arg| arg.strip_prefix("--profile-directory="))
            .unwrap_or("Default");
        configure_user_data_dir_for_profile(
            &profile,
            selected,
            options.default_browser_check,
            &options.preferences,
            &options.local_state,
        )?;
        prepare_session_restore(
            &profile,
            keep_session_cookies,
            options.restore_tabs,
            &options.args,
        )?;
        if options.automation_parity
            && !options
                .args
                .iter()
                .any(|arg| arg.starts_with("--remote-debugging-port"))
        {
            options.args.push(format!(
                "--remote-debugging-port={}",
                crate::browser::debugging_port::reserve_loopback_port()?
            ));
        }
    }
    let manager = normalize_download_options(options.downloads.clone())
        .map(DownloadManager::create)
        .transpose()?;
    let staging = manager
        .as_ref()
        .map(|manager| crate::downloads::sources::prepare_staging_directory(&manager.directory))
        .transpose()?;
    let capabilities = build_capabilities(&options, &profile, staging.as_deref())?;
    let port = crate::browser::debugging_port::reserve_loopback_port()?;
    let executable = driver_executable(&options);
    let args = match options.browser {
        WebDriverBrowser::Chrome => {
            vec![format!("--port={port}"), "--allowed-ips=127.0.0.1".into()]
        }
        WebDriverBrowser::Firefox => vec![
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
            // geckodriver otherwise shares port 9222 across sessions, even
            // when its WebDriver HTTP port is allocated dynamically.
            "--websocket-port".into(),
            "0".into(),
        ],
        WebDriverBrowser::Safari | WebDriverBrowser::SafariTechnologyPreview => {
            vec!["--port".into(), port.to_string()]
        }
    };
    let output = Arc::new(std::sync::Mutex::new(Vec::new()));
    let tail = output.clone();
    let listener: crate::utilities::OutputListener = Arc::new(move |chunk| {
        tracing::debug!(output = %String::from_utf8_lossy(chunk), "WebDriver output");
        let mut tail = tail.lock().unwrap();
        tail.extend_from_slice(chunk);
        if tail.len() > 8192 {
            let excess = tail.len() - 8192;
            tail.drain(..excess);
        }
    });
    owner.child = Some(Arc::new(
        start_process(
            executable.to_string_lossy().as_ref(),
            &args,
            StartProcessOptions {
                env: {
                    let mut env = options.env.clone().unwrap_or_default();
                    if options.browser == WebDriverBrowser::Firefox && !options.sandbox {
                        env.insert("MOZ_DISABLE_CONTENT_SANDBOX".into(), "1".into());
                    }
                    (!env.is_empty()).then_some(env)
                },
                on_stdout: vec![listener.clone()],
                on_stderr: vec![listener],
                ..Default::default()
            },
        )
        .await
        .with_context(|| format!("start WebDriver {}", executable.display()))?,
    ));
    let endpoint = format!("http://127.0.0.1:{port}");
    let launched = timeout(options.launch_timeout, async {
        loop {
            if let Some(code) = owner.child.as_ref().and_then(|child| child.exit_code()) {
                return Err(anyhow!(
                    "WebDriver exited with {code}: {}",
                    String::from_utf8_lossy(&output.lock().unwrap())
                ));
            }
            if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
                break;
            }
            sleep(Duration::from_millis(25)).await;
        }
        let client = fantoccini::ClientBuilder::rustls()?
            .capabilities(capabilities)
            .connect(&endpoint)
            .await?;
        // Safari reports an empty URL until its first navigation.
        if safari {
            client.goto("about:blank").await?;
        }
        if options.browser == WebDriverBrowser::Firefox
            && keep_session_cookies == Some(true)
            && !options.restore_tabs
        {
            start_driven_tab(&client).await?;
        }
        Ok::<_, anyhow::Error>(client)
    })
    .await;
    let client = match launched {
        Ok(Ok(client)) => client,
        result => {
            owner.stop().await?;
            return match result {
                Ok(Err(error)) => Err(if safari {
                    crate::browser::safari::launch_error(error, options.browser)
                } else {
                    error
                }),
                _ => Err(anyhow!(
                    "WebDriver launch timed out: {}",
                    String::from_utf8_lossy(&output.lock().unwrap())
                )),
            };
        }
    };
    let mut browser = ManagedWebDriver {
        browser: options.browser,
        client,
        bidi: None,
        downloads: manager,
        profile,
        default_restrictions,
        keep_session_cookies: keep_session_cookies == Some(true),
        warnings,
        driver: tokio::sync::Mutex::new(owner),
        closed: OnceCell::new(),
    };
    let setup = async {
        if options.bidi {
            if let Some(url) = browser
                .client
                .capabilities()
                .and_then(|caps| caps.get("webSocketUrl"))
                .and_then(Value::as_str)
            {
                browser.bidi = Some(Arc::new(BidiClient::connect(url).await?));
            }
        }
        if let Some(manager) = &browser.downloads {
            manager.attach_filesystem().await?;
        }
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if let Err(error) = setup {
        browser.close().await?;
        return Err(error);
    }
    Ok(browser)
}

#[cfg(test)]
mod driver_tests {
    use super::*;
    use crate::browser::browser_cookie_sources::tests::TempDir;

    fn executable(root: &Path, relative: &str) -> PathBuf {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    #[test]
    fn chrome_for_testing_gets_the_chromedriver_of_its_release() {
        let temp = TempDir::new("bc-webdriver-driver-");
        let cft = executable(temp.path(), "selenium/chrome/linux64/131.0.6778.85/chrome");
        let driver = executable(
            temp.path(),
            "selenium/chromedriver/linux64/131.0.6778.85/chromedriver",
        );
        let options = |browser_executable: Option<PathBuf>| WebDriverOptions {
            browser_executable,
            ..WebDriverOptions::default()
        };
        assert_eq!(driver_executable(&options(Some(cft.clone()))), driver);
        // Without one downloaded, or for another browser, the driver on PATH.
        let other = executable(temp.path(), "selenium/chrome/linux64/132.0.1/chrome");
        assert_eq!(
            driver_executable(&options(Some(other))),
            PathBuf::from("chromedriver")
        );
        assert_eq!(
            driver_executable(&options(Some("/opt/google/chrome/chrome".into()))),
            PathBuf::from("chromedriver")
        );
        assert_eq!(
            driver_executable(&options(None)),
            PathBuf::from("chromedriver")
        );
        // A requested driver always wins.
        let requested = WebDriverOptions {
            driver_executable: Some("/opt/chromedriver".into()),
            ..options(Some(cft))
        };
        assert_eq!(
            driver_executable(&requested),
            PathBuf::from("/opt/chromedriver")
        );
    }
}
