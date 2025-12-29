//! Common constants used across the browser automation library.
//!
//! This module contains timing constants and Chrome arguments used for
//! browser operations.

use std::time::Duration;

/// Common Chrome arguments used across both browser engines.
///
/// These arguments are used to configure Chrome/Chromium in a way that
/// optimizes for automation and reduces user interruptions.
pub const CHROME_ARGS: &[&str] = &[
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--disable-infobars",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-crash-restore",
];

/// Timing constants for browser operations.
///
/// These durations are used throughout the library to control
/// wait times, timeouts, and animation durations.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// Wait time for scroll animations to complete.
    pub scroll_animation_wait: Duration,
    /// Default wait after scrolling to element.
    pub default_wait_after_scroll: Duration,
    /// Timeout for quick visibility checks.
    pub visibility_check_timeout: Duration,
    /// Default timeout for most operations.
    pub default_timeout: Duration,
    /// Default timeout for navigation operations.
    pub navigation_timeout: Duration,
    /// Default timeout for action verification.
    pub verification_timeout: Duration,
    /// Interval between verification retries.
    pub verification_retry_interval: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            scroll_animation_wait: Duration::from_millis(300),
            default_wait_after_scroll: Duration::from_millis(1000),
            visibility_check_timeout: Duration::from_millis(100),
            default_timeout: Duration::from_millis(5000),
            navigation_timeout: Duration::from_millis(30000),
            verification_timeout: Duration::from_millis(3000),
            verification_retry_interval: Duration::from_millis(100),
        }
    }
}

/// Default timing configuration.
pub static TIMING: std::sync::LazyLock<Timing> = std::sync::LazyLock::new(Timing::default);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chrome_args_is_not_empty() {
        assert!(!CHROME_ARGS.is_empty());
    }

    #[test]
    fn chrome_args_contains_expected_arguments() {
        assert!(CHROME_ARGS.contains(&"--disable-infobars"));
        assert!(CHROME_ARGS.contains(&"--no-first-run"));
        assert!(CHROME_ARGS.contains(&"--no-default-browser-check"));
    }

    #[test]
    fn chrome_args_contains_crash_related_flags() {
        assert!(CHROME_ARGS.contains(&"--disable-session-crashed-bubble"));
        assert!(CHROME_ARGS.contains(&"--hide-crash-restore-bubble"));
        assert!(CHROME_ARGS.contains(&"--disable-crash-restore"));
    }

    #[test]
    fn chrome_args_has_at_least_5_arguments() {
        assert!(CHROME_ARGS.len() >= 5);
    }

    #[test]
    fn timing_default_values_are_reasonable() {
        let timing = Timing::default();

        // All timeouts should be positive
        assert!(timing.scroll_animation_wait > Duration::ZERO);
        assert!(timing.default_wait_after_scroll > Duration::ZERO);
        assert!(timing.visibility_check_timeout > Duration::ZERO);
        assert!(timing.default_timeout > Duration::ZERO);
        assert!(timing.navigation_timeout > Duration::ZERO);
        assert!(timing.verification_timeout > Duration::ZERO);
        assert!(timing.verification_retry_interval > Duration::ZERO);

        // Navigation timeout should be longer than default timeout
        assert!(timing.navigation_timeout > timing.default_timeout);
    }

    #[test]
    fn timing_scroll_animation_wait_is_300ms() {
        let timing = Timing::default();
        assert_eq!(timing.scroll_animation_wait, Duration::from_millis(300));
    }

    #[test]
    fn timing_default_wait_after_scroll_is_1000ms() {
        let timing = Timing::default();
        assert_eq!(timing.default_wait_after_scroll, Duration::from_millis(1000));
    }

    #[test]
    fn timing_visibility_check_timeout_is_100ms() {
        let timing = Timing::default();
        assert_eq!(timing.visibility_check_timeout, Duration::from_millis(100));
    }

    #[test]
    fn timing_default_timeout_is_5000ms() {
        let timing = Timing::default();
        assert_eq!(timing.default_timeout, Duration::from_millis(5000));
    }

    #[test]
    fn timing_navigation_timeout_is_30000ms() {
        let timing = Timing::default();
        assert_eq!(timing.navigation_timeout, Duration::from_millis(30000));
    }
}
