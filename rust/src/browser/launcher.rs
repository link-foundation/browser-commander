//! Browser launcher for browser automation.
//!
//! This module provides utilities for launching browser instances
//! with appropriate configuration.

use crate::core::constants::CHROME_ARGS;
use crate::core::engine::EngineType;
use std::path::PathBuf;

/// Options for launching a browser.
#[derive(Debug, Clone)]
pub struct LaunchOptions {
    /// The browser engine to use.
    pub engine: EngineType,
    /// Path to user data directory.
    pub user_data_dir: Option<PathBuf>,
    /// Run in headless mode.
    pub headless: bool,
    /// Slow down operations by this many milliseconds.
    pub slow_mo: u64,
    /// Enable verbose logging.
    pub verbose: bool,
    /// Additional Chrome arguments.
    pub args: Vec<String>,
}

impl Default for LaunchOptions {
    fn default() -> Self {
        Self {
            engine: EngineType::Chromiumoxide,
            user_data_dir: None,
            headless: false,
            slow_mo: 0,
            verbose: false,
            args: Vec::new(),
        }
    }
}

impl LaunchOptions {
    /// Create options for chromiumoxide engine.
    pub fn chromiumoxide() -> Self {
        Self {
            engine: EngineType::Chromiumoxide,
            ..Default::default()
        }
    }

    /// Create options for fantoccini (WebDriver) engine.
    pub fn fantoccini() -> Self {
        Self {
            engine: EngineType::Fantoccini,
            ..Default::default()
        }
    }

    /// Set headless mode.
    pub fn headless(mut self, headless: bool) -> Self {
        self.headless = headless;
        self
    }

    /// Set the user data directory.
    pub fn user_data_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.user_data_dir = Some(dir.into());
        self
    }

    /// Set slow motion delay.
    pub fn slow_mo(mut self, ms: u64) -> Self {
        self.slow_mo = ms;
        self
    }

    /// Enable verbose logging.
    pub fn verbose(mut self, verbose: bool) -> Self {
        self.verbose = verbose;
        self
    }

    /// Add additional Chrome arguments.
    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }

    /// Get all Chrome arguments (default + custom).
    pub fn all_chrome_args(&self) -> Vec<String> {
        let mut all_args: Vec<String> = CHROME_ARGS.iter().map(|s| s.to_string()).collect();
        all_args.extend(self.args.clone());
        all_args
    }

    /// Get the user data directory, using a default if not specified.
    pub fn get_user_data_dir(&self) -> PathBuf {
        if let Some(ref dir) = self.user_data_dir {
            dir.clone()
        } else {
            let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
            home.join(".browser-commander")
                .join(format!("{}-data", self.engine))
        }
    }
}

/// Browser instance wrapper.
///
/// This is a placeholder struct that would wrap the actual browser
/// instance from the underlying engine (chromiumoxide or fantoccini).
#[derive(Debug)]
pub struct Browser {
    /// The engine type being used.
    pub engine: EngineType,
    /// The user data directory.
    pub user_data_dir: PathBuf,
    /// Whether the browser is running headless.
    pub headless: bool,
}

/// Result of a browser launch.
#[derive(Debug)]
pub struct LaunchResult {
    /// The browser instance.
    pub browser: Browser,
}

/// Launch a browser with the given options.
///
/// Note: This is a placeholder implementation. The actual implementation
/// would use chromiumoxide or fantoccini to launch a real browser.
///
/// # Arguments
///
/// * `options` - Launch options
///
/// # Returns
///
/// The launch result containing the browser instance
///
/// # Errors
///
/// Returns an error if the browser fails to launch
pub async fn launch_browser(options: LaunchOptions) -> Result<LaunchResult, anyhow::Error> {
    if options.verbose {
        tracing::info!(
            "Launching browser with {} engine...",
            options.engine
        );
    }

    let user_data_dir = options.get_user_data_dir();

    // Create user data directory if it doesn't exist
    std::fs::create_dir_all(&user_data_dir)?;

    // This is a placeholder - actual implementation would launch real browser
    let browser = Browser {
        engine: options.engine,
        user_data_dir,
        headless: options.headless,
    };

    if options.verbose {
        tracing::info!("Browser launched with {} engine", options.engine);
    }

    Ok(LaunchResult { browser })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_options_default() {
        let options = LaunchOptions::default();
        assert_eq!(options.engine, EngineType::Chromiumoxide);
        assert!(!options.headless);
        assert_eq!(options.slow_mo, 0);
        assert!(!options.verbose);
        assert!(options.args.is_empty());
    }

    #[test]
    fn launch_options_builder() {
        let options = LaunchOptions::chromiumoxide()
            .headless(true)
            .slow_mo(100)
            .verbose(true)
            .with_args(vec!["--custom-arg".to_string()]);

        assert_eq!(options.engine, EngineType::Chromiumoxide);
        assert!(options.headless);
        assert_eq!(options.slow_mo, 100);
        assert!(options.verbose);
        assert_eq!(options.args, vec!["--custom-arg"]);
    }

    #[test]
    fn launch_options_fantoccini() {
        let options = LaunchOptions::fantoccini();
        assert_eq!(options.engine, EngineType::Fantoccini);
    }

    #[test]
    fn all_chrome_args_includes_defaults() {
        let options = LaunchOptions::default();
        let args = options.all_chrome_args();

        assert!(args.contains(&"--disable-infobars".to_string()));
        assert!(args.contains(&"--no-first-run".to_string()));
    }

    #[test]
    fn all_chrome_args_includes_custom() {
        let options = LaunchOptions::default().with_args(vec!["--custom".to_string()]);
        let args = options.all_chrome_args();

        assert!(args.contains(&"--custom".to_string()));
    }

    #[test]
    fn get_user_data_dir_uses_custom() {
        let options = LaunchOptions::default().user_data_dir("/custom/path");
        assert_eq!(options.get_user_data_dir(), PathBuf::from("/custom/path"));
    }

    #[test]
    fn get_user_data_dir_creates_default() {
        let options = LaunchOptions::default();
        let dir = options.get_user_data_dir();
        assert!(dir.to_string_lossy().contains("browser-commander"));
        assert!(dir.to_string_lossy().contains("chromiumoxide-data"));
    }
}
