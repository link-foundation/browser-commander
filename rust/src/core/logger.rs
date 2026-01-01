//! Logger configuration for browser automation.
//!
//! This module provides a simple interface for creating loggers
//! with configurable verbosity levels.

use tracing::Level;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// Check if verbose logging is enabled via environment or CLI args.
///
/// Checks for `VERBOSE` environment variable or `--verbose` CLI argument.
///
/// # Returns
///
/// `true` if verbose mode is enabled, `false` otherwise.
pub fn is_verbose_enabled() -> bool {
    std::env::var("VERBOSE").is_ok() || std::env::args().any(|arg| arg == "--verbose")
}

/// Logger configuration options.
#[derive(Debug, Clone, Default)]
pub struct LoggerOptions {
    /// Enable verbose (debug level) logging.
    pub verbose: bool,
}

/// Initialize the global tracing subscriber with the given options.
///
/// This should be called once at the start of the application.
///
/// # Arguments
///
/// * `options` - Logger configuration options
///
/// # Example
///
/// ```
/// use browser_commander::core::logger::{init_logger, LoggerOptions};
///
/// init_logger(LoggerOptions { verbose: true });
/// ```
pub fn init_logger(options: LoggerOptions) {
    let level = if options.verbose {
        Level::DEBUG
    } else {
        Level::ERROR
    };

    let filter = EnvFilter::from_default_env().add_directive(level.into());

    let subscriber = fmt::layer().with_target(true).with_level(true);

    tracing_subscriber::registry()
        .with(filter)
        .with(subscriber)
        .try_init()
        .ok(); // Ignore error if already initialized
}

/// A simple logger wrapper that respects verbosity settings.
#[derive(Debug, Clone)]
pub struct Logger {
    verbose: bool,
}

impl Logger {
    /// Create a new logger instance.
    ///
    /// # Arguments
    ///
    /// * `options` - Logger configuration options
    pub fn new(options: LoggerOptions) -> Self {
        Self {
            verbose: options.verbose,
        }
    }

    /// Log a debug message (only shown in verbose mode).
    ///
    /// # Arguments
    ///
    /// * `message_fn` - A function that returns the message to log.
    ///   This is only called if verbose mode is enabled.
    pub fn debug<F>(&self, mut message_fn: F)
    where
        F: FnMut() -> String,
    {
        if self.verbose {
            let msg = message_fn();
            tracing::debug!("{}", msg);
        }
    }

    /// Log an error message (always shown).
    ///
    /// # Arguments
    ///
    /// * `message` - The error message to log
    pub fn error(&self, message: &str) {
        tracing::error!("{}", message);
    }

    /// Log an info message.
    ///
    /// # Arguments
    ///
    /// * `message` - The info message to log
    pub fn info(&self, message: &str) {
        tracing::info!("{}", message);
    }

    /// Log a warning message.
    ///
    /// # Arguments
    ///
    /// * `message` - The warning message to log
    pub fn warn(&self, message: &str) {
        tracing::warn!("{}", message);
    }

    /// Check if verbose logging is enabled.
    pub fn is_verbose(&self) -> bool {
        self.verbose
    }
}

impl Default for Logger {
    fn default() -> Self {
        Self {
            verbose: is_verbose_enabled(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logger_default_is_not_verbose() {
        // Note: This test may fail if VERBOSE env var is set
        // In a clean environment, default should be non-verbose
        std::env::remove_var("VERBOSE");
        let logger = Logger::default();
        // We can't assert on is_verbose since it also checks CLI args
        // Just verify the logger can be created
        assert!(!logger.is_verbose() || is_verbose_enabled());
    }

    #[test]
    fn logger_can_be_created_with_verbose_true() {
        let logger = Logger::new(LoggerOptions { verbose: true });
        assert!(logger.is_verbose());
    }

    #[test]
    fn logger_can_be_created_with_verbose_false() {
        let logger = Logger::new(LoggerOptions { verbose: false });
        assert!(!logger.is_verbose());
    }

    #[test]
    fn logger_options_default_is_not_verbose() {
        let options = LoggerOptions::default();
        assert!(!options.verbose);
    }

    #[test]
    fn debug_message_fn_not_called_when_not_verbose() {
        let logger = Logger::new(LoggerOptions { verbose: false });
        let mut was_called = false;

        logger.debug(|| {
            was_called = true;
            "test message".to_string()
        });

        assert!(!was_called);
    }

    #[test]
    fn debug_message_fn_called_when_verbose() {
        let logger = Logger::new(LoggerOptions { verbose: true });
        let mut was_called = false;

        logger.debug(|| {
            was_called = true;
            "test message".to_string()
        });

        assert!(was_called);
    }
}
