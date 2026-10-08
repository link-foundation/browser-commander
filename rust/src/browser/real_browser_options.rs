//! Builder and defaults for installed-browser options.
use super::*;

impl Default for RealBrowserOptions {
    fn default() -> Self {
        Self {
            engine: EngineType::Chromiumoxide,
            channel: "chrome".to_string(),
            executable_path: None,
            user_data_dir: None,
            persist_session_cookies: None,
            profile_directory: "Default".into(),
            default_browser_check: None,
            first_run: false,
            preferences: serde_json::json!({}),
            local_state: serde_json::json!({}),
            storage_state: None,
            remote_debugging_port: None,
            port_attempts: DEFAULT_PORT_ATTEMPTS,
            headless: false,
            restrictions: Vec::new(),
            args: Vec::new(),
            extra_args: Vec::new(),
            ignore_default_args: Vec::new(),
            ignore_all_default_args: false,
            env: None,
            automation_parity: true,
            startup_timeout: Duration::from_secs(30),
            close_timeout: DEFAULT_CLOSE_TIMEOUT,
            slow_mo: 0,
            timeout: None,
            protocol_timeout: None,
            seed_cookies: Vec::new(),
            migrate_from: None,
            migrate_include: None,
            migrate_domains: Vec::new(),
            migrate_password_csv: None,
            migrate_include_payment_cards: false,
            verbose: false,
            diagnostic_redactor: None,
            node_executable: None,
            node_working_dir: None,
            downloads: DownloadSetting::Off,
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

    /// Select a dedicated browser profile instead of a temporary one.
    pub fn user_data_dir(mut self, user_data_dir: impl Into<PathBuf>) -> Self {
        self.user_data_dir = Some(user_data_dir.into());
        self
    }
    /// Restore portable cookies and origin-scoped localStorage after connecting.
    pub fn storage_state(mut self, state: impl Into<StorageStateInput>) -> Self {
        self.storage_state = Some(state.into());
        self
    }
    /// Use a fixed loopback CDP port instead of a reserved one. Zero is
    /// refused at launch.
    pub fn remote_debugging_port(mut self, port: u16) -> Self {
        self.remote_debugging_port = Some(port);
        self
    }

    /// Set how many reserved ports to try when another process takes one.
    pub fn port_attempts(mut self, attempts: u32) -> Self {
        self.port_attempts = attempts;
        self
    }

    /// Enable or disable headless mode.
    pub fn headless(mut self, headless: bool) -> Self {
        self.headless = headless;
        self
    }

    /// Opt in to named launch restrictions or presets.
    pub fn restrictions<I, S>(mut self, restrictions: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.restrictions = restrictions.into_iter().map(Into::into).collect();
        self
    }

    /// Set additional browser arguments.
    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }

    /// Add browser arguments after the compatibility `args` field.
    pub fn with_extra_args(mut self, args: Vec<String>) -> Self {
        self.extra_args = args;
        self
    }

    /// Has no effect since issue #103: Browser Commander adds no defaults.
    #[deprecated(
        since = "0.13.0",
        note = "Browser Commander adds no default switches any more; opt in with `restrictions` instead"
    )]
    pub fn ignore_default_args(mut self, args: Vec<String>) -> Self {
        self.ignore_default_args = args;
        self
    }

    /// Has no effect since issue #103: Browser Commander adds no defaults.
    #[deprecated(
        since = "0.13.0",
        note = "Browser Commander adds no default switches any more; opt in with `restrictions` instead"
    )]
    pub fn ignore_all_default_args(mut self) -> Self {
        self.ignore_all_default_args = true;
        self
    }

    /// Extra environment for the browser process only.
    pub fn env(mut self, env: HashMap<String, String>) -> Self {
        self.env = Some(env);
        self
    }

    /// Keep `navigator.webdriver` false when a switch would turn it on.
    pub fn automation_parity(mut self, enabled: bool) -> Self {
        self.automation_parity = enabled;
        self
    }

    /// Set the CDP readiness timeout.
    pub fn startup_timeout(mut self, timeout: Duration) -> Self {
        self.startup_timeout = timeout;
        self
    }

    /// Set how long closing waits for the browser to exit before killing it.
    pub fn close_timeout(mut self, timeout: Duration) -> Self {
        self.close_timeout = timeout;
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

    /// Copy supported profile data before launch and seed its cookies over CDP.
    #[must_use]
    pub fn migrate_from(mut self, source: MigrationSource) -> Self {
        self.migrate_from = Some(source);
        self
    }

    /// Restrict a profile migration to the selected data classes.
    #[must_use]
    pub fn migrate_include<I, S>(mut self, include: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.migrate_include = Some(include.into_iter().map(Into::into).collect());
        self
    }

    /// Restrict migrated cookies to the selected hosts.
    #[must_use]
    pub fn migrate_domains<I, S>(mut self, domains: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.migrate_domains = domains.into_iter().map(Into::into).collect();
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

    /// Manage the installed browser's downloads.
    ///
    /// # Arguments
    ///
    /// * `downloads` - `true` for the defaults, `false` for none, or
    ///   [`DownloadOptions`](crate::downloads::DownloadOptions)
    pub fn downloads(mut self, downloads: impl Into<DownloadSetting>) -> Self {
        self.downloads = downloads.into();
        self
    }

    /// The profile a launch would use: the configured one, or Browser
    /// Commander's old managed per-channel directory.
    #[deprecated(
        since = "0.13.0",
        note = "launch_real_browser uses a fresh temporary profile unless user_data_dir is set; read RealBrowserLaunchResult::user_data_dir"
    )]
    pub fn get_user_data_dir(&self) -> PathBuf {
        self.user_data_dir
            .clone()
            .unwrap_or_else(|| default_real_browser_user_data_dir(&self.channel))
    }
}
