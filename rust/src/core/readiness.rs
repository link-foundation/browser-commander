//! Readiness primitives - one monotonic deadline, checks that report evidence.
//!
//! Navigation used to answer "did the page settle?" and then throw the answer
//! away: `wait_for_url_stabilization` returned `false` on timeout, the caller
//! discarded it, and the navigation was reported as a success anyway. These
//! types make the answer impossible to discard - a readiness wait carries the
//! evidence for every check it ran, and one deadline bounds all of them.

use serde_json::{json, Value};
use std::fmt;
use std::time::{Duration, Instant};

/// How a readiness wait ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReadinessStatus {
    /// Every check was satisfied.
    #[default]
    Ready,
    /// The budget ran out before every check could answer.
    TimedOut,
    /// A check reported, within budget, that it was not satisfied.
    Failed,
}

impl fmt::Display for ReadinessStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ReadinessStatus::Ready => write!(f, "ready"),
            ReadinessStatus::TimedOut => write!(f, "timed_out"),
            ReadinessStatus::Failed => write!(f, "failed"),
        }
    }
}

/// A monotonic budget shared by every check in one readiness wait.
///
/// The clock is monotonic on purpose: a wall-clock jump - an NTP correction, a
/// suspended laptop - must not turn a five second budget into a five minute
/// one. `remaining` never grows, so no caller can be handed a larger budget
/// than the one it asked for.
#[derive(Debug, Clone)]
pub struct Deadline {
    started_at: Instant,
    timeout: Duration,
}

impl Deadline {
    /// Start a deadline with the given total budget.
    #[must_use]
    pub fn new(timeout: Duration) -> Self {
        Self {
            started_at: Instant::now(),
            timeout,
        }
    }

    /// Total budget this deadline was created with.
    #[must_use]
    pub fn timeout(&self) -> Duration {
        self.timeout
    }

    /// Time spent so far.
    #[must_use]
    pub fn elapsed(&self) -> Duration {
        self.started_at.elapsed()
    }

    /// Elapsed milliseconds, for evidence records.
    #[must_use]
    pub fn elapsed_ms(&self) -> u128 {
        self.elapsed().as_millis()
    }

    /// Budget left, saturating at zero.
    #[must_use]
    pub fn remaining(&self) -> Duration {
        self.timeout.saturating_sub(self.elapsed())
    }

    /// Whether the budget is spent.
    #[must_use]
    pub fn expired(&self) -> bool {
        self.remaining().is_zero()
    }

    /// Sleep for at most the remaining budget.
    pub async fn sleep_at_most(&self, requested: Duration) {
        let capped = requested.min(self.remaining());
        if !capped.is_zero() {
            tokio::time::sleep(capped).await;
        }
    }
}

/// Evidence for one check that ran.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckRecord {
    /// Check name.
    pub name: String,
    /// Whether the check was satisfied.
    pub satisfied: bool,
    /// Whether the check could not run and was skipped.
    pub skipped: bool,
    /// Milliseconds into the wait at which the check started.
    pub started_at_ms: u128,
    /// Milliseconds the check itself took.
    pub elapsed_ms: u128,
    /// Structured detail describing what the check observed.
    pub detail: Value,
}

impl CheckRecord {
    /// Record a satisfied check.
    #[must_use]
    pub fn satisfied(name: impl Into<String>, detail: Value) -> Self {
        Self {
            name: name.into(),
            satisfied: true,
            skipped: false,
            started_at_ms: 0,
            elapsed_ms: 0,
            detail,
        }
    }

    /// Record a check that was not satisfied.
    #[must_use]
    pub fn unsatisfied(name: impl Into<String>, detail: Value) -> Self {
        Self {
            name: name.into(),
            satisfied: false,
            skipped: false,
            started_at_ms: 0,
            elapsed_ms: 0,
            detail,
        }
    }

    /// Record a check that could not run.
    #[must_use]
    pub fn skipped(name: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            satisfied: false,
            skipped: true,
            started_at_ms: 0,
            elapsed_ms: 0,
            detail: json!({ "reason": reason.into() }),
        }
    }

    /// Attach the timing window the check occupied.
    #[must_use]
    pub fn with_timing(mut self, started_at_ms: u128, elapsed_ms: u128) -> Self {
        self.started_at_ms = started_at_ms;
        self.elapsed_ms = elapsed_ms;
        self
    }
}

/// The outcome of a readiness wait, with the evidence behind it.
#[derive(Debug, Clone, Default)]
pub struct ReadinessOutcome {
    /// How the wait ended.
    pub status: ReadinessStatus,
    /// Whether every check was satisfied.
    pub ready: bool,
    /// Names of satisfied checks.
    pub satisfied: Vec<String>,
    /// Names of checks that reported "not satisfied".
    pub failed: Vec<String>,
    /// Names of checks that could not run.
    pub skipped: Vec<String>,
    /// Names of checks that never started because the budget ran out.
    pub pending: Vec<String>,
    /// Evidence for every check that ran.
    pub evidence: Vec<CheckRecord>,
    /// Total milliseconds spent.
    pub elapsed_ms: u128,
    /// The budget the wait was given.
    pub timeout_ms: u128,
}

impl ReadinessOutcome {
    /// Start an empty outcome bound to a deadline's budget.
    #[must_use]
    pub fn new(deadline: &Deadline) -> Self {
        Self {
            status: ReadinessStatus::Ready,
            ready: true,
            timeout_ms: deadline.timeout().as_millis(),
            ..Self::default()
        }
    }

    /// Fold one check's evidence into the outcome.
    pub fn record(&mut self, record: CheckRecord) {
        if record.skipped {
            self.skipped.push(record.name.clone());
        } else if record.satisfied {
            self.satisfied.push(record.name.clone());
        } else {
            self.failed.push(record.name.clone());
        }
        self.evidence.push(record);
    }

    /// Note a check that never got to run.
    pub fn defer(&mut self, name: impl Into<String>) {
        self.pending.push(name.into());
    }

    /// Settle the status against the deadline once every check has reported.
    #[must_use]
    pub fn finish(mut self, deadline: &Deadline) -> Self {
        self.ready = self.failed.is_empty() && self.pending.is_empty();
        self.elapsed_ms = deadline.elapsed_ms();
        self.status = if self.ready {
            ReadinessStatus::Ready
        } else if deadline.expired() {
            ReadinessStatus::TimedOut
        } else {
            ReadinessStatus::Failed
        };
        self
    }

    /// A one-line summary suitable for a result reason.
    #[must_use]
    pub fn summary(&self) -> String {
        if self.ready {
            return format!("page ready after {}ms", self.elapsed_ms);
        }
        format!(
            "page not ready ({}) after {}ms; failed=[{}] pending=[{}]",
            self.status,
            self.elapsed_ms,
            self.failed.join(", "),
            self.pending.join(", ")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_deadline_never_hands_out_more_budget_than_it_was_given() {
        // Regression guard for issue #89: the JS implementation computed
        // `max(60000, timeout - elapsed)`, so a 10ms budget became 60s.
        let deadline = Deadline::new(Duration::from_millis(10));

        assert!(deadline.remaining() <= Duration::from_millis(10));
        assert_eq!(deadline.timeout(), Duration::from_millis(10));
    }

    #[test]
    fn remaining_saturates_at_zero() {
        let deadline = Deadline::new(Duration::ZERO);

        assert!(deadline.expired());
        assert_eq!(deadline.remaining(), Duration::ZERO);
    }

    #[tokio::test]
    async fn sleeping_is_capped_by_the_remaining_budget() {
        let deadline = Deadline::new(Duration::from_millis(20));

        deadline.sleep_at_most(Duration::from_secs(30)).await;

        assert!(deadline.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn an_unsatisfied_check_never_reports_ready() {
        // Regression guard for issue #89: "did not stabilize" used to be
        // discarded and the operation reported as a success.
        let deadline = Deadline::new(Duration::from_secs(5));
        let mut outcome = ReadinessOutcome::new(&deadline);

        outcome.record(CheckRecord::unsatisfied(
            "url_stable_for",
            json!({ "url": "https://example.com/" }),
        ));
        let outcome = outcome.finish(&deadline);

        assert!(!outcome.ready);
        assert_eq!(outcome.status, ReadinessStatus::Failed);
        assert_eq!(outcome.failed, vec!["url_stable_for".to_string()]);
        assert!(outcome.summary().contains("url_stable_for"));
    }

    #[test]
    fn an_expired_budget_reports_timed_out() {
        let deadline = Deadline::new(Duration::ZERO);
        let mut outcome = ReadinessOutcome::new(&deadline);

        outcome.record(CheckRecord::unsatisfied("url_stable_for", json!({})));
        let outcome = outcome.finish(&deadline);

        assert_eq!(outcome.status, ReadinessStatus::TimedOut);
    }

    #[test]
    fn a_skipped_check_does_not_block_readiness() {
        let deadline = Deadline::new(Duration::from_secs(5));
        let mut outcome = ReadinessOutcome::new(&deadline);

        outcome.record(CheckRecord::skipped("network_idle_for", "no tracker"));
        let outcome = outcome.finish(&deadline);

        assert!(outcome.ready);
        assert_eq!(outcome.skipped, vec!["network_idle_for".to_string()]);
    }

    #[test]
    fn checks_that_never_ran_are_pending_not_satisfied() {
        let deadline = Deadline::new(Duration::from_secs(5));
        let mut outcome = ReadinessOutcome::new(&deadline);

        outcome.record(CheckRecord::satisfied("url_stable_for", json!({})));
        outcome.defer("verify_navigation");
        let outcome = outcome.finish(&deadline);

        assert!(!outcome.ready);
        assert_eq!(outcome.pending, vec!["verify_navigation".to_string()]);
    }

    #[test]
    fn evidence_carries_the_timing_window_of_each_check() {
        let record = CheckRecord::satisfied("url_stable_for", json!({})).with_timing(5, 12);

        assert_eq!(record.started_at_ms, 5);
        assert_eq!(record.elapsed_ms, 12);
    }

    #[test]
    fn statuses_render_the_documented_names() {
        assert_eq!(ReadinessStatus::Ready.to_string(), "ready");
        assert_eq!(ReadinessStatus::TimedOut.to_string(), "timed_out");
        assert_eq!(ReadinessStatus::Failed.to_string(), "failed");
    }
}
