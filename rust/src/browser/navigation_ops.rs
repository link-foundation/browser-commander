//! Navigation operations for browser automation.
//!
//! This module provides high-level navigation utilities with
//! verification and stabilization support.

use crate::core::constants::TIMING;
use crate::core::engine::{EngineAdapter, EngineError};
use crate::core::navigation::is_navigation_error;
use crate::core::readiness::{CheckRecord, Deadline, ReadinessOutcome};
use serde_json::json;
use std::time::{Duration, Instant};

/// Options for navigation operations.
#[derive(Debug, Clone)]
pub struct NavigationOptions {
    /// Wait until condition for navigation.
    pub wait_until: WaitUntil,
    /// Navigation timeout.
    pub timeout: Duration,
    /// Whether to wait for URL to stabilize before navigation.
    pub wait_for_stable_url_before: bool,
    /// Whether to wait for URL to stabilize after navigation.
    pub wait_for_stable_url_after: bool,
    /// Whether to verify the navigation.
    pub verify: bool,
    /// Verification timeout.
    pub verification_timeout: Duration,
    /// Number of consecutive stable checks required.
    pub stable_checks: u32,
    /// Interval between stability checks.
    pub check_interval: Duration,
}

impl Default for NavigationOptions {
    fn default() -> Self {
        Self {
            wait_until: WaitUntil::DomContentLoaded,
            timeout: TIMING.navigation_timeout,
            wait_for_stable_url_before: true,
            wait_for_stable_url_after: true,
            verify: true,
            verification_timeout: TIMING.verification_timeout,
            stable_checks: 3,
            check_interval: Duration::from_secs(1),
        }
    }
}

/// Wait until conditions for page load.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum WaitUntil {
    /// Wait for DOMContentLoaded event.
    #[default]
    DomContentLoaded,
    /// Wait for load event.
    Load,
    /// Wait for network to be idle.
    NetworkIdle,
}

impl std::fmt::Display for WaitUntil {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WaitUntil::DomContentLoaded => write!(f, "domcontentloaded"),
            WaitUntil::Load => write!(f, "load"),
            WaitUntil::NetworkIdle => write!(f, "networkidle"),
        }
    }
}

/// Result of a navigation verification.
#[derive(Debug, Clone)]
pub struct NavigationVerificationResult {
    /// Whether the navigation was verified as successful.
    pub verified: bool,
    /// The actual URL after navigation.
    pub actual_url: String,
    /// The reason for the verification result.
    pub reason: String,
    /// Number of verification attempts.
    pub attempts: u32,
}

/// Result of a navigation operation.
#[derive(Debug, Clone)]
pub struct NavigationResult {
    /// Whether navigation was performed.
    pub navigated: bool,
    /// Whether the navigation was verified as successful.
    pub verified: bool,
    /// The actual URL after navigation.
    pub actual_url: Option<String>,
    /// The reason for the result.
    pub reason: Option<String>,
    /// Evidence for every readiness check the navigation ran.
    ///
    /// `None` when the navigation ended before any check could run.
    pub readiness: Option<ReadinessOutcome>,
}

impl NavigationResult {
    /// Create a successful navigation result.
    pub fn success(actual_url: String) -> Self {
        Self {
            navigated: true,
            verified: true,
            actual_url: Some(actual_url),
            reason: Some("navigation completed".to_string()),
            readiness: None,
        }
    }

    /// Create a result indicating navigation was interrupted.
    pub fn interrupted(reason: impl Into<String>) -> Self {
        Self {
            navigated: false,
            verified: false,
            actual_url: None,
            reason: Some(reason.into()),
            readiness: None,
        }
    }

    /// Attach readiness evidence.
    ///
    /// A navigation whose readiness checks did not pass is not verified, no
    /// matter what the URL says - the previous code discarded the verdict and
    /// reported success regardless.
    #[must_use]
    pub fn with_readiness(mut self, readiness: ReadinessOutcome) -> Self {
        if !readiness.ready {
            self.verified = false;
            self.reason = Some(readiness.summary());
        }
        self.readiness = Some(readiness);
        self
    }
}

/// Verify that navigation completed successfully.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `expected_url` - The expected URL (optional, for pattern matching)
/// * `start_url` - The URL before navigation
/// * `options` - Navigation options
///
/// # Returns
///
/// The verification result
pub async fn verify_navigation(
    adapter: &dyn EngineAdapter,
    expected_url: Option<&str>,
    start_url: &str,
    options: &NavigationOptions,
) -> Result<NavigationVerificationResult, EngineError> {
    let deadline = Deadline::new(options.verification_timeout);
    verify_navigation_within(adapter, expected_url, start_url, options, &deadline).await
}

/// Verify navigation within a budget shared with the rest of the navigation.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `expected_url` - The expected URL (optional, for pattern matching)
/// * `start_url` - The URL before navigation
/// * `options` - Navigation options
/// * `deadline` - The budget shared with every other check
///
/// # Returns
///
/// The verification result
pub async fn verify_navigation_within(
    adapter: &dyn EngineAdapter,
    expected_url: Option<&str>,
    start_url: &str,
    options: &NavigationOptions,
    deadline: &Deadline,
) -> Result<NavigationVerificationResult, EngineError> {
    // Verification never gets more time than the navigation has left, however
    // generous its own timeout is.
    let budget = options.verification_timeout.min(deadline.remaining());
    let start_time = Instant::now();
    let mut attempts = 0u32;

    while start_time.elapsed() < budget {
        attempts += 1;

        let actual_url = match adapter.url().await {
            Ok(url) => url,
            Err(e) if is_navigation_error(&e.to_string()) => {
                return Ok(NavigationVerificationResult {
                    verified: false,
                    actual_url: String::new(),
                    reason: "error during verification".to_string(),
                    attempts,
                });
            }
            Err(e) => return Err(e),
        };

        // If expected URL is provided, verify it matches
        if let Some(expected) = expected_url {
            if actual_url == expected {
                return Ok(NavigationVerificationResult {
                    verified: true,
                    actual_url,
                    reason: "exact URL match".to_string(),
                    attempts,
                });
            }

            if actual_url.contains(expected) || actual_url.starts_with(expected) {
                return Ok(NavigationVerificationResult {
                    verified: true,
                    actual_url,
                    reason: "URL pattern match".to_string(),
                    attempts,
                });
            }
        } else {
            // No expected URL - just verify URL changed from start
            if actual_url != start_url {
                return Ok(NavigationVerificationResult {
                    verified: true,
                    actual_url,
                    reason: "URL changed from start".to_string(),
                    attempts,
                });
            }
        }

        deadline.sleep_at_most(Duration::from_millis(100)).await;
    }

    // Final check
    let actual_url = adapter.url().await?;

    Ok(NavigationVerificationResult {
        verified: false,
        actual_url: actual_url.clone(),
        reason: format!(
            "URL mismatch: expected {:?}, got \"{}\"",
            expected_url, actual_url
        ),
        attempts,
    })
}

/// Wait for the URL to stop changing, reporting what was observed.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `options` - Navigation options
/// * `deadline` - The budget shared with every other check in this navigation
/// * `name` - Check name recorded in the evidence
///
/// # Returns
///
/// The evidence for this check
pub async fn url_stable_within(
    adapter: &dyn EngineAdapter,
    options: &NavigationOptions,
    deadline: &Deadline,
    name: &str,
) -> Result<CheckRecord, EngineError> {
    let started_at_ms = deadline.elapsed_ms();
    let mut stable_count = 0u32;
    let mut last_url = adapter.url().await?;

    while stable_count < options.stable_checks {
        if deadline.expired() {
            let elapsed = deadline.elapsed_ms() - started_at_ms;
            return Ok(CheckRecord::unsatisfied(
                name,
                json!({
                    "url": last_url,
                    "stableChecks": stable_count,
                    "requiredChecks": options.stable_checks,
                    "reason": "deadline reached",
                }),
            )
            .with_timing(started_at_ms, elapsed));
        }

        deadline.sleep_at_most(options.check_interval).await;

        let current_url = adapter.url().await?;

        if current_url == last_url {
            stable_count += 1;
        } else {
            stable_count = 0;
            last_url = current_url;
        }
    }

    let elapsed = deadline.elapsed_ms() - started_at_ms;
    Ok(CheckRecord::satisfied(
        name,
        json!({ "url": last_url, "stableChecks": stable_count }),
    )
    .with_timing(started_at_ms, elapsed))
}

/// Wait for URL to stabilize (no more redirects).
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `options` - Navigation options
/// * `reason` - Reason for stabilization (for logging)
///
/// # Returns
///
/// `true` if stabilized, `false` if timeout
pub async fn wait_for_url_stabilization(
    adapter: &dyn EngineAdapter,
    options: &NavigationOptions,
    reason: &str,
) -> Result<bool, EngineError> {
    let deadline = Deadline::new(options.timeout);
    let record = url_stable_within(adapter, options, &deadline, reason).await?;
    Ok(record.satisfied)
}

/// Navigate to a URL.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `url` - The URL to navigate to
/// * `options` - Navigation options
///
/// # Returns
///
/// The result of the navigation
pub async fn goto(
    adapter: &dyn EngineAdapter,
    url: &str,
    options: &NavigationOptions,
) -> Result<NavigationResult, EngineError> {
    let start_url = adapter.url().await?;
    // One monotonic budget covers stabilization before, stabilization after and
    // verification. Each step used to get a full timeout of its own, so the
    // total wait could be several times the timeout the caller asked for.
    let deadline = Deadline::new(options.timeout);
    let mut readiness = ReadinessOutcome::new(&deadline);

    // Wait for URL to stabilize before navigation (if requested)
    if options.wait_for_stable_url_before {
        let record = url_stable_within(adapter, options, &deadline, "url_stable_before").await?;
        readiness.record(record);
    }

    // Perform navigation
    match adapter.goto(url).await {
        Ok(_) => {}
        Err(e) if is_navigation_error(&e.to_string()) => {
            return Ok(NavigationResult::interrupted("navigation was interrupted"));
        }
        Err(e) => return Err(e),
    }

    // Wait for URL to stabilize after navigation (if requested)
    if options.wait_for_stable_url_after {
        let record = url_stable_within(adapter, options, &deadline, "url_stable_after").await?;
        readiness.record(record);
    }

    // Verify navigation if requested
    if options.verify {
        if deadline.expired() {
            // The budget is gone, so verification never ran. Saying so is the
            // point: a check that did not run is not a check that passed.
            readiness.defer("verify_navigation");
        } else {
            let started_at_ms = deadline.elapsed_ms();
            let verification =
                verify_navigation_within(adapter, Some(url), &start_url, options, &deadline)
                    .await?;
            let detail = json!({
                "actualUrl": verification.actual_url,
                "reason": verification.reason,
                "attempts": verification.attempts,
            });
            let record = if verification.verified {
                CheckRecord::satisfied("verify_navigation", detail)
            } else {
                CheckRecord::unsatisfied("verify_navigation", detail)
            }
            .with_timing(started_at_ms, deadline.elapsed_ms() - started_at_ms);
            readiness.record(record);
            let readiness = readiness.finish(&deadline);

            return Ok(NavigationResult {
                navigated: true,
                verified: verification.verified,
                actual_url: Some(verification.actual_url.clone()),
                reason: Some(if readiness.ready {
                    verification.reason
                } else {
                    readiness.summary()
                }),
                readiness: Some(readiness),
            });
        }
    }

    let readiness = readiness.finish(&deadline);
    let actual_url = adapter.url().await?;
    Ok(NavigationResult::success(actual_url).with_readiness(readiness))
}

/// Wait for navigation to complete.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `timeout_ms` - Timeout in milliseconds
///
/// # Returns
///
/// `true` if navigation completed, `false` on timeout or error
pub async fn wait_for_navigation(
    adapter: &dyn EngineAdapter,
    timeout_ms: u64,
) -> Result<bool, EngineError> {
    match adapter.wait_for_navigation(timeout_ms).await {
        Ok(_) => Ok(true),
        Err(e) if is_navigation_error(&e.to_string()) => Ok(false),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::stub_engine::StubEngine;

    #[test]
    fn navigation_options_default() {
        let options = NavigationOptions::default();
        assert_eq!(options.wait_until, WaitUntil::DomContentLoaded);
        assert!(options.wait_for_stable_url_before);
        assert!(options.wait_for_stable_url_after);
        assert!(options.verify);
        assert_eq!(options.stable_checks, 3);
    }

    #[test]
    fn wait_until_display() {
        assert_eq!(WaitUntil::DomContentLoaded.to_string(), "domcontentloaded");
        assert_eq!(WaitUntil::Load.to_string(), "load");
        assert_eq!(WaitUntil::NetworkIdle.to_string(), "networkidle");
    }

    #[test]
    fn navigation_result_success() {
        let result = NavigationResult::success("https://example.com".to_string());
        assert!(result.navigated);
        assert!(result.verified);
        assert_eq!(result.actual_url, Some("https://example.com".to_string()));
    }

    #[test]
    fn navigation_result_interrupted() {
        let result = NavigationResult::interrupted("page was closed");
        assert!(!result.navigated);
        assert!(!result.verified);
        assert!(result.actual_url.is_none());
        assert_eq!(result.reason, Some("page was closed".to_string()));
    }

    /// Options that keep the tests fast: a small budget polled often.
    fn quick_options(timeout_ms: u64) -> NavigationOptions {
        NavigationOptions {
            timeout: Duration::from_millis(timeout_ms),
            verification_timeout: Duration::from_millis(timeout_ms),
            stable_checks: 2,
            check_interval: Duration::from_millis(5),
            ..NavigationOptions::default()
        }
    }

    #[tokio::test]
    async fn an_unstable_url_is_not_reported_as_verified() {
        // Regression test for issue #89: `wait_for_url_stabilization` returned
        // `false`, `goto` discarded it, and the navigation was reported as a
        // verified success anyway.
        let engine = StubEngine::never_stable();
        let options = NavigationOptions {
            wait_for_stable_url_before: false,
            verify: false,
            ..quick_options(60)
        };

        let result = goto(&engine, "https://example.com/target", &options)
            .await
            .unwrap();

        assert!(result.navigated);
        assert!(!result.verified);
        let readiness = result.readiness.expect("readiness evidence");
        assert!(!readiness.ready);
        assert_eq!(readiness.failed, vec!["url_stable_after".to_string()]);
        assert!(result.reason.unwrap().contains("url_stable_after"));
    }

    #[tokio::test]
    async fn a_stable_url_is_recorded_as_satisfied_evidence() {
        let engine = StubEngine::fixed("https://example.com/target");
        let options = NavigationOptions {
            wait_for_stable_url_before: false,
            verify: false,
            ..quick_options(2_000)
        };

        let result = goto(&engine, "https://example.com/target", &options)
            .await
            .unwrap();

        assert!(result.verified);
        let readiness = result.readiness.expect("readiness evidence");
        assert!(readiness.ready);
        assert_eq!(readiness.satisfied, vec!["url_stable_after".to_string()]);
        assert_eq!(readiness.evidence.len(), 1);
        assert_eq!(readiness.evidence[0].detail["stableChecks"], 2);
    }

    #[tokio::test]
    async fn goto_shares_one_budget_across_every_check() {
        // Regression test for issue #89: stabilization before, stabilization
        // after and verification each used to get a full timeout of their own,
        // so a 60ms navigation could wait 180ms or more.
        let engine = StubEngine::never_stable();
        let options = quick_options(60);

        let started = Instant::now();
        let result = goto(&engine, "https://example.com/target", &options)
            .await
            .unwrap();
        let elapsed = started.elapsed();

        assert!(
            elapsed < Duration::from_millis(120),
            "goto took {elapsed:?}, which is more than one 60ms budget"
        );
        let readiness = result.readiness.expect("readiness evidence");
        assert!(readiness.elapsed_ms >= 60);
        assert_eq!(
            readiness.failed,
            vec![
                "url_stable_before".to_string(),
                "url_stable_after".to_string()
            ]
        );
    }

    #[tokio::test]
    async fn verification_that_never_ran_is_pending_not_satisfied() {
        let engine = StubEngine::never_stable();
        let options = quick_options(40);

        let result = goto(&engine, "https://example.com/target", &options)
            .await
            .unwrap();

        let readiness = result.readiness.expect("readiness evidence");
        assert_eq!(readiness.pending, vec!["verify_navigation".to_string()]);
        assert!(!readiness
            .satisfied
            .contains(&"verify_navigation".to_string()));
    }

    #[tokio::test]
    async fn verification_never_outlives_the_navigation_budget() {
        // The verification timeout is far more generous than the budget the
        // navigation has left, so the deadline must win.
        let engine = StubEngine::fixed("https://example.com/start");
        let options = NavigationOptions {
            verification_timeout: Duration::from_secs(30),
            ..quick_options(50)
        };
        let deadline = Deadline::new(Duration::from_millis(50));

        let started = Instant::now();
        let verification = verify_navigation_within(
            &engine,
            Some("https://example.com/target"),
            "https://example.com/start",
            &options,
            &deadline,
        )
        .await
        .unwrap();

        assert!(!verification.verified);
        assert!(
            started.elapsed() < Duration::from_millis(500),
            "verification outlived the navigation budget"
        );
    }

    #[tokio::test]
    async fn stabilization_evidence_carries_its_timing_window() {
        let engine = StubEngine::fixed("https://example.com/target");
        let deadline = Deadline::new(Duration::from_millis(500));
        let options = quick_options(500);

        let record = url_stable_within(&engine, &options, &deadline, "url_stable_after")
            .await
            .unwrap();

        assert!(record.satisfied);
        assert_eq!(record.name, "url_stable_after");
        assert!(record.elapsed_ms >= 5);
    }

    #[tokio::test]
    async fn the_legacy_stabilization_wrapper_still_reports_a_bool() {
        let stable = StubEngine::fixed("https://example.com/target");
        let unstable = StubEngine::never_stable();
        let options = quick_options(40);

        assert!(wait_for_url_stabilization(&stable, &options, "after")
            .await
            .unwrap());
        assert!(!wait_for_url_stabilization(&unstable, &options, "after")
            .await
            .unwrap());
    }
}
