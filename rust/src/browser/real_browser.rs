//! Launch genuine installed Chrome-family browsers and attach over CDP.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::browser::connector::{connect_browser, ConnectOptions};
use crate::browser::launcher::{Browser, LaunchResult};
use crate::core::engine::{EngineAdapter, EngineType};

const MANAGED_ARGUMENTS: [&str; 3] = [
    "--remote-debugging-address",
    "--remote-debugging-port",
    "--user-data-dir",
];

/// Options for launching an installed browser and attaching over CDP.
#[derive(Debug, Clone)]
pub struct RealBrowserOptions {
    /// Browser Commander engine used after the browser starts.
    pub engine: EngineType,
    /// Installed Chrome-family channel to discover.
    pub channel: String,
    /// Explicit installed-browser executable, bypassing channel discovery.
    pub executable_path: Option<PathBuf>,
    /// Dedicated, non-default browser profile.
    pub user_data_dir: Option<PathBuf>,
    /// Loopback CDP port. Zero lets Chrome choose an available port.
    pub remote_debugging_port: u16,
    /// Run the installed browser headlessly.
    pub headless: bool,
    /// Additional browser arguments.
    pub args: Vec<String>,
    /// Maximum time to wait for Chrome's `/json/version` endpoint.
    pub startup_timeout: Duration,
    /// Delay Playwright/Puppeteer operations by this many milliseconds.
    pub slow_mo: u64,
    /// Optional connection timeout.
    pub timeout: Option<Duration>,
    /// Optional Puppeteer timeout for individual CDP calls.
    pub protocol_timeout: Option<Duration>,
    /// Cookies to seed immediately after attaching.
    pub seed_cookies: Vec<Value>,
    /// Enable browser and connector logging.
    pub verbose: bool,
    /// Node.js executable for Playwright/Puppeteer bridge engines.
    pub node_executable: Option<PathBuf>,
    /// Directory where Node resolves Playwright/Puppeteer.
    pub node_working_dir: Option<PathBuf>,
}

impl Default for RealBrowserOptions {
    fn default() -> Self {
        Self {
            engine: EngineType::Chromiumoxide,
            channel: "chrome".to_string(),
            executable_path: None,
            user_data_dir: None,
            remote_debugging_port: 0,
            headless: false,
            args: Vec::new(),
            startup_timeout: Duration::from_secs(30),
            slow_mo: 0,
            timeout: None,
            protocol_timeout: None,
            seed_cookies: Vec::new(),
            verbose: false,
            node_executable: None,
            node_working_dir: None,
        }
    }
}

impl RealBrowserOptions {
    /// Create native Chromiumoxide options.
    pub fn chromiumoxide() -> Self {
        Self::default()
    }

    /// Create Playwright bridge options.
    pub fn playwright() -> Self {
        Self {
            engine: EngineType::Playwright,
            slow_mo: 150,
            ..Self::default()
        }
    }

    /// Create Puppeteer bridge options.
    pub fn puppeteer() -> Self {
        Self {
            engine: EngineType::Puppeteer,
            ..Self::default()
        }
    }

    /// Select an installed browser channel.
    pub fn channel(mut self, channel: impl Into<String>) -> Self {
        self.channel = channel.into();
        self
    }

    /// Select an explicit installed-browser executable.
    pub fn executable_path(mut self, executable_path: impl Into<PathBuf>) -> Self {
        self.executable_path = Some(executable_path.into());
        self
    }

    /// Select a dedicated browser profile.
    pub fn user_data_dir(mut self, user_data_dir: impl Into<PathBuf>) -> Self {
        self.user_data_dir = Some(user_data_dir.into());
        self
    }

    /// Select a loopback CDP port. Zero asks Chrome to allocate one.
    pub fn remote_debugging_port(mut self, port: u16) -> Self {
        self.remote_debugging_port = port;
        self
    }

    /// Enable or disable headless mode.
    pub fn headless(mut self, headless: bool) -> Self {
        self.headless = headless;
        self
    }

    /// Set additional browser arguments.
    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }

    /// Set the CDP readiness timeout.
    pub fn startup_timeout(mut self, timeout: Duration) -> Self {
        self.startup_timeout = timeout;
        self
    }

    /// Set the engine operation delay.
    pub fn slow_mo(mut self, milliseconds: u64) -> Self {
        self.slow_mo = milliseconds;
        self
    }

    /// Set the connection timeout.
    pub fn timeout(mut self, timeout: Duration) -> Self {
        self.timeout = Some(timeout);
        self
    }

    /// Set Puppeteer's timeout for individual CDP calls.
    pub fn protocol_timeout(mut self, timeout: Duration) -> Self {
        self.protocol_timeout = Some(timeout);
        self
    }

    /// Seed cookies after attaching.
    pub fn seed_cookies(mut self, cookies: Vec<Value>) -> Self {
        self.seed_cookies = cookies;
        self
    }

    /// Enable launch and connection logging.
    pub fn verbose(mut self, verbose: bool) -> Self {
        self.verbose = verbose;
        self
    }

    /// Override the Node.js executable for bridge engines.
    pub fn node_executable(mut self, executable: impl Into<PathBuf>) -> Self {
        self.node_executable = Some(executable.into());
        self
    }

    /// Set the directory where Node resolves Playwright/Puppeteer.
    pub fn node_working_dir(mut self, directory: impl Into<PathBuf>) -> Self {
        self.node_working_dir = Some(directory.into());
        self
    }

    /// Resolve the configured or managed dedicated profile path.
    pub fn get_user_data_dir(&self) -> PathBuf {
        self.user_data_dir
            .clone()
            .unwrap_or_else(|| default_real_browser_user_data_dir(&self.channel))
    }
}

/// Owned installed-browser process. Dropping it terminates the spawned browser.
pub struct BrowserProcess {
    child: Child,
}

impl BrowserProcess {
    fn new(child: Child) -> Self {
        Self { child }
    }

    /// Operating-system process identifier.
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    /// Return the exit status if the browser has stopped.
    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    /// Terminate and reap the installed-browser process.
    pub fn kill(&mut self) -> io::Result<()> {
        if self.child.try_wait()?.is_some() {
            return Ok(());
        }
        self.child.kill()?;
        self.child.wait()?;
        Ok(())
    }
}

impl std::fmt::Debug for BrowserProcess {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BrowserProcess")
            .field("id", &self.id())
            .finish()
    }
}

impl Drop for BrowserProcess {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}

/// Browser/page handles plus metadata for the spawned installed browser.
pub struct RealBrowserLaunchResult {
    /// Browser metadata matching [`LaunchResult`].
    pub browser: Browser,
    /// Shared engine adapter matching [`LaunchResult`].
    pub page: Arc<dyn EngineAdapter>,
    /// Resolved loopback DevTools endpoint.
    pub cdp_endpoint: String,
    /// Resolved installed-browser executable.
    pub executable_path: PathBuf,
    /// Dedicated profile used by the browser.
    pub user_data_dir: PathBuf,
    /// Owned process handle. Dropping the result terminates the browser.
    pub browser_process: BrowserProcess,
}

impl std::fmt::Debug for RealBrowserLaunchResult {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RealBrowserLaunchResult")
            .field("browser", &self.browser)
            .field("page", &"<dyn EngineAdapter>")
            .field("cdp_endpoint", &self.cdp_endpoint)
            .field("executable_path", &self.executable_path)
            .field("user_data_dir", &self.user_data_dir)
            .field("browser_process", &self.browser_process)
            .finish()
    }
}

/// Return Browser Commander's managed dedicated profile for a channel.
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

fn known_default_user_data_dirs() -> Vec<PathBuf> {
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

/// Resolve a genuine installed Chrome-family browser executable.
pub fn resolve_system_browser_executable(
    options: &RealBrowserOptions,
) -> Result<PathBuf, anyhow::Error> {
    let candidates = if let Some(executable_path) = &options.executable_path {
        vec![normalize_for_comparison(executable_path)]
    } else {
        browser_install_candidates(&options.channel)?
    };

    for candidate in candidates {
        if is_executable(&candidate) {
            return Ok(candidate);
        }
    }

    if let Some(executable_path) = &options.executable_path {
        Err(anyhow::anyhow!(
            "browser executable is not accessible: {}",
            executable_path.display()
        ))
    } else {
        Err(anyhow::anyhow!(
            "could not find an installed {} browser; provide executable_path",
            options.channel
        ))
    }
}

/// Build the protected command line for an installed browser process.
pub fn build_real_browser_args(options: &RealBrowserOptions) -> Result<Vec<String>, anyhow::Error> {
    for argument in &options.args {
        if MANAGED_ARGUMENTS
            .iter()
            .any(|managed| argument == managed || argument.starts_with(&format!("{managed}=")))
        {
            return Err(anyhow::anyhow!(
                "{argument} is managed by launch_real_browser"
            ));
        }
    }

    let mut arguments = vec![
        "--remote-debugging-address=127.0.0.1".to_string(),
        format!("--remote-debugging-port={}", options.remote_debugging_port),
        format!("--user-data-dir={}", options.get_user_data_dir().display()),
        "--no-first-run".to_string(),
        "--no-default-browser-check".to_string(),
    ];
    if options.headless {
        arguments.push("--headless=new".to_string());
    }
    arguments.extend(options.args.clone());
    Ok(arguments)
}

fn response_has_cdp_websocket(response: &[u8]) -> bool {
    if !(response.starts_with(b"HTTP/1.1 200") || response.starts_with(b"HTTP/1.0 200")) {
        return false;
    }
    let Some(header_end) = response.windows(4).position(|window| window == b"\r\n\r\n") else {
        return false;
    };
    serde_json::from_slice::<Value>(&response[header_end + 4..])
        .ok()
        .and_then(|value| value.get("webSocketDebuggerUrl").cloned())
        .and_then(|value| value.as_str().map(str::to_owned))
        .is_some()
}

async fn fetch_cdp_version(port: u16, timeout: Duration) -> bool {
    let request = format!(
        "GET /json/version HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    );
    let request_future = async {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).await?;
        stream.write_all(request.as_bytes()).await?;
        let mut response = Vec::new();
        let mut chunk = [0_u8; 4096];
        loop {
            let bytes_read = stream.read(&mut chunk).await?;
            if bytes_read == 0 {
                break;
            }
            response.extend_from_slice(&chunk[..bytes_read]);
            if response_has_cdp_websocket(&response) {
                return Ok::<bool, io::Error>(true);
            }
            if response.len() > 1024 * 1024 {
                return Ok(false);
            }
        }
        Ok(response_has_cdp_websocket(&response))
    };
    matches!(
        tokio::time::timeout(timeout, request_future).await,
        Ok(Ok(true))
    )
}

async fn wait_for_cdp_endpoint(
    options: &RealBrowserOptions,
    user_data_dir: &Path,
    browser_process: &mut BrowserProcess,
) -> Result<String, anyhow::Error> {
    let started = Instant::now();
    let active_port_path = user_data_dir.join("DevToolsActivePort");

    while started.elapsed() < options.startup_timeout {
        if let Some(status) = browser_process.try_wait()? {
            return Err(anyhow::anyhow!(
                "browser exited before its DevTools endpoint was ready ({status})"
            ));
        }

        let mut port = options.remote_debugging_port;
        if port == 0 {
            port = std::fs::read_to_string(&active_port_path)
                .ok()
                .and_then(|contents| contents.lines().next()?.parse::<u16>().ok())
                .unwrap_or(0);
        }

        if port > 0 {
            let remaining = options.startup_timeout.saturating_sub(started.elapsed());
            if fetch_cdp_version(port, remaining.min(Duration::from_millis(500))).await {
                return Ok(format!("http://127.0.0.1:{port}"));
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    Err(anyhow::anyhow!(
        "timed out after {}ms waiting for the DevTools endpoint",
        options.startup_timeout.as_millis()
    ))
}

fn connection_options(
    options: &RealBrowserOptions,
    endpoint: &str,
) -> Result<ConnectOptions, anyhow::Error> {
    let mut connection = match options.engine {
        EngineType::Chromiumoxide => ConnectOptions::chromiumoxide(),
        EngineType::Playwright => ConnectOptions::playwright(),
        EngineType::Puppeteer => ConnectOptions::puppeteer(),
        EngineType::Fantoccini => {
            return Err(anyhow::anyhow!(
                "fantoccini does not connect over CDP; use chromiumoxide, playwright, or puppeteer"
            ));
        }
    };
    connection.cdp_endpoint = Some(endpoint.to_string());
    connection.slow_mo = options.slow_mo;
    connection.timeout = options.timeout;
    connection.protocol_timeout = options.protocol_timeout;
    connection.seed_cookies = options.seed_cookies.clone();
    connection.verbose = options.verbose;
    connection.node_executable = options.node_executable.clone();
    connection.node_working_dir = options.node_working_dir.clone();
    Ok(connection)
}

/// Launch a genuine installed browser with an isolated profile and attach.
///
/// Chrome 136 and newer ignore remote-debugging switches for default profiles,
/// so this helper rejects known default profile roots. It only binds CDP to
/// loopback, verifies `/json/version`, and then delegates to [`connect_browser`].
pub async fn launch_real_browser(
    options: RealBrowserOptions,
) -> Result<RealBrowserLaunchResult, anyhow::Error> {
    if options.engine == EngineType::Fantoccini {
        return Err(anyhow::anyhow!(
            "fantoccini does not connect over CDP; use chromiumoxide, playwright, or puppeteer"
        ));
    }

    let user_data_dir = options.get_user_data_dir();
    assert_dedicated_user_data_dir(&user_data_dir)?;
    std::fs::create_dir_all(&user_data_dir)?;

    let executable_path = resolve_system_browser_executable(&options)?;
    let arguments = build_real_browser_args(&options)?;
    let output = if options.verbose {
        Stdio::inherit()
    } else {
        Stdio::null()
    };
    let child = Command::new(&executable_path)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(output)
        .stderr(if options.verbose {
            Stdio::inherit()
        } else {
            Stdio::null()
        })
        .spawn()
        .map_err(|error| {
            anyhow::anyhow!(
                "failed to start installed browser {}: {error}",
                executable_path.display()
            )
        })?;
    let mut browser_process = BrowserProcess::new(child);

    let cdp_endpoint =
        match wait_for_cdp_endpoint(&options, &user_data_dir, &mut browser_process).await {
            Ok(endpoint) => endpoint,
            Err(error) => {
                let _ = browser_process.kill();
                return Err(error);
            }
        };

    let connect_options = connection_options(&options, &cdp_endpoint)?;
    let LaunchResult { mut browser, page } = match connect_browser(connect_options).await {
        Ok(connection) => connection,
        Err(error) => {
            let _ = browser_process.kill();
            return Err(error);
        }
    };
    browser.user_data_dir = user_data_dir.clone();
    browser.headless = options.headless;

    Ok(RealBrowserLaunchResult {
        browser,
        page,
        cdp_endpoint,
        executable_path,
        user_data_dir,
        browser_process,
    })
}

/// Descriptive alias for [`launch_real_browser`].
pub async fn launch_and_connect_real_browser(
    options: RealBrowserOptions,
) -> Result<RealBrowserLaunchResult, anyhow::Error> {
    launch_real_browser(options).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_options_use_native_engine_and_managed_profile() {
        let options = RealBrowserOptions::default();
        assert_eq!(options.engine, EngineType::Chromiumoxide);
        assert_eq!(options.channel, "chrome");
        assert_eq!(options.remote_debugging_port, 0);
        assert!(options
            .get_user_data_dir()
            .to_string_lossy()
            .contains("real-browser"));
    }

    #[test]
    fn rejects_the_current_platform_default_profiles() {
        for profile in known_default_user_data_dirs() {
            let error = assert_dedicated_user_data_dir(&profile).unwrap_err();
            assert!(error.to_string().contains("dedicated user_data_dir"));
        }
    }

    #[test]
    fn all_required_channels_have_discovery_candidates() {
        for channel in ["chrome", "chromium", "brave", "msedge"] {
            assert!(!browser_install_candidates(channel).unwrap().is_empty());
        }

        let chrome = browser_install_candidates("chrome").unwrap();
        #[cfg(target_os = "macos")]
        assert!(chrome.contains(&PathBuf::from(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        )));
        #[cfg(target_os = "windows")]
        assert!(chrome.iter().any(
            |candidate| candidate.ends_with(Path::new("Google/Chrome/Application/chrome.exe"))
        ));
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        assert!(chrome.contains(&PathBuf::from("/usr/bin/google-chrome")));
    }

    #[test]
    fn rejects_fantoccini_before_connecting() {
        let options = RealBrowserOptions {
            engine: EngineType::Fantoccini,
            ..RealBrowserOptions::default()
        };
        assert!(connection_options(&options, "http://127.0.0.1:9222").is_err());
    }

    #[tokio::test]
    async fn rejects_fantoccini_before_starting_a_browser() {
        let options = RealBrowserOptions {
            engine: EngineType::Fantoccini,
            executable_path: Some(PathBuf::from("missing-browser")),
            ..RealBrowserOptions::default()
        };

        let error = launch_real_browser(options).await.unwrap_err();
        assert!(error.to_string().contains("does not connect over CDP"));
    }

    #[tokio::test]
    async fn cdp_probe_does_not_wait_for_the_server_to_close_the_connection() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let response_body = r#"{"webSocketDebuggerUrl":"ws://127.0.0.1/devtools/browser/id"}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{response_body}",
            response_body.len()
        );
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            stream.write_all(response.as_bytes()).await.unwrap();
            tokio::time::sleep(Duration::from_secs(1)).await;
        });

        assert!(fetch_cdp_version(port, Duration::from_millis(200)).await);
        server.abort();
    }
}
