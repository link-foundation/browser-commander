//! Truthful result model for click operations.
//!
//! The old model answered every click with two booleans, and both of them were
//! optimistic: a button that did nothing still reported `verified: true`. This
//! model separates three questions that used to be conflated - did we dispatch
//! the click, did the page react, and how did the operation end - and records
//! the evidence behind each answer.

use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

/// How a click operation ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickStatus {
    /// The click was dispatched and its effect was confirmed.
    Succeeded,
    /// The click could not be dispatched, or dispatch provably failed.
    Failed,
    /// The operation ran out of its budget.
    TimedOut,
    /// Navigation or an explicit stop cut the operation short.
    Interrupted,
    /// The click was dispatched, but nothing confirmed or denied an effect.
    Unverified,
}

impl fmt::Display for ClickStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::TimedOut => "timed_out",
            Self::Interrupted => "interrupted",
            Self::Unverified => "unverified",
        };
        write!(f, "{text}")
    }
}

/// What the page did in response to the click.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickEffect {
    /// Evidence was observed that the click did something.
    Confirmed,
    /// No evidence either way.
    NotObserved,
    /// Evidence was observed that the click did *not* do what was expected.
    Contradicted,
}

impl fmt::Display for ClickEffect {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Confirmed => "confirmed",
            Self::NotObserved => "not-observed",
            Self::Contradicted => "contradicted",
        };
        write!(f, "{text}")
    }
}

/// One observation behind a click verdict.
///
/// Evidence is structured rather than prose so that callers can assert on it
/// and so that a trace can carry it without re-parsing a sentence.
#[derive(Debug, Clone, PartialEq)]
pub struct Evidence {
    /// Evidence kind, for example `element-state` or `navigation`.
    pub kind: String,
    /// Structured detail describing the observation.
    pub detail: Value,
}

impl Evidence {
    /// Build one piece of evidence.
    pub fn new(kind: impl Into<String>, detail: Value) -> Self {
        Self {
            kind: kind.into(),
            detail,
        }
    }

    /// Build evidence whose only detail is a message.
    pub fn message(kind: impl Into<String>, message: impl Into<String>) -> Self {
        Self::new(kind, json!({ "message": message.into() }))
    }
}

static ACTION_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Produce a correlation ID for a single click action.
///
/// Navigation evidence is only meaningful when it can be tied back to the click
/// that is supposed to have caused it, so every click carries one of these.
pub fn next_action_id() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = ACTION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("click-{stamp:x}-{seq:06x}")
}

/// Result of a click operation.
///
/// `clicked` and `verified` are retained for callers written against the old
/// API, but they are now *derived* from the honest fields rather than being set
/// optimistically: `verified` is true only when the effect was confirmed.
#[derive(Debug, Clone)]
pub struct ClickResult {
    /// How the operation ended.
    pub status: ClickStatus,
    /// Whether the click was actually delivered to the page.
    pub dispatched: bool,
    /// What the page was observed to do.
    pub effect: ClickEffect,
    /// Whether a navigation was observed around the click.
    pub navigated: bool,
    /// The reason for the result.
    pub reason: String,
    /// How long the operation took.
    pub elapsed_ms: u128,
    /// Observations behind the verdict.
    pub evidence: Vec<Evidence>,
    /// Correlation ID for this click.
    pub action_id: String,
    /// Legacy alias for [`ClickResult::dispatched`].
    pub clicked: bool,
    /// Legacy alias for "the effect was confirmed".
    pub verified: bool,
}

impl ClickResult {
    /// Build a result, deriving the legacy booleans from the honest fields.
    pub fn new(
        status: ClickStatus,
        dispatched: bool,
        effect: ClickEffect,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            status,
            dispatched,
            effect,
            navigated: false,
            reason: reason.into(),
            elapsed_ms: 0,
            evidence: Vec::new(),
            action_id: next_action_id(),
            clicked: dispatched,
            verified: effect == ClickEffect::Confirmed,
        }
    }

    /// Attach the observations behind this verdict.
    #[must_use]
    pub fn with_evidence(mut self, evidence: Vec<Evidence>) -> Self {
        self.evidence = evidence;
        self
    }

    /// Record how long the operation took.
    #[must_use]
    pub fn with_elapsed_ms(mut self, elapsed_ms: u128) -> Self {
        self.elapsed_ms = elapsed_ms;
        self
    }

    /// Record that a navigation was observed.
    #[must_use]
    pub fn with_navigated(mut self, navigated: bool) -> Self {
        self.navigated = navigated;
        self
    }

    /// Reuse an existing correlation ID.
    #[must_use]
    pub fn with_action_id(mut self, action_id: impl Into<String>) -> Self {
        self.action_id = action_id.into();
        self
    }

    /// A click whose effect was confirmed.
    pub fn success(reason: impl Into<String>) -> Self {
        Self::new(ClickStatus::Succeeded, true, ClickEffect::Confirmed, reason)
    }

    /// A click that was delivered but whose effect nothing confirmed.
    ///
    /// This replaces the old "assumed success" verdict.
    pub fn unverified(reason: impl Into<String>) -> Self {
        Self::new(
            ClickStatus::Unverified,
            true,
            ClickEffect::NotObserved,
            reason,
        )
    }

    /// A click cut short by navigation.
    ///
    /// Navigation is *not* evidence that this click caused it: the navigation
    /// may well have been in flight before the click was dispatched.
    pub fn navigation(reason: impl Into<String>) -> Self {
        Self::new(
            ClickStatus::Interrupted,
            false,
            ClickEffect::NotObserved,
            reason,
        )
        .with_navigated(true)
    }

    /// A click that could not be delivered.
    pub fn failed(reason: impl Into<String>) -> Self {
        Self::new(ClickStatus::Failed, false, ClickEffect::NotObserved, reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn success_confirms_the_effect() {
        let result = ClickResult::success("element clicked");
        assert!(result.dispatched);
        assert!(result.clicked);
        assert!(result.verified);
        assert_eq!(result.status, ClickStatus::Succeeded);
        assert_eq!(result.effect, ClickEffect::Confirmed);
    }

    #[test]
    fn unverified_never_claims_verification() {
        // Regression test for issue #89: a dispatched click with no observed
        // effect used to report `verified: true`.
        let result = ClickResult::unverified("no observable change");
        assert!(result.dispatched);
        assert!(result.clicked);
        assert!(!result.verified);
        assert_eq!(result.status, ClickStatus::Unverified);
        assert_eq!(result.effect, ClickEffect::NotObserved);
    }

    #[test]
    fn navigation_is_not_proof_of_effect() {
        // Regression test for issue #89: navigation used to set `verified: true`
        // even though it may have been in flight before the click.
        let result = ClickResult::navigation("page navigated");
        assert!(!result.clicked);
        assert!(!result.verified);
        assert!(result.navigated);
        assert_eq!(result.status, ClickStatus::Interrupted);
        assert_eq!(result.effect, ClickEffect::NotObserved);
    }

    #[test]
    fn failed_reports_no_dispatch() {
        let result = ClickResult::failed("element not found");
        assert!(!result.clicked);
        assert!(!result.verified);
        assert!(!result.navigated);
        assert_eq!(result.status, ClickStatus::Failed);
    }

    #[test]
    fn statuses_and_effects_render_the_documented_names() {
        assert_eq!(ClickStatus::TimedOut.to_string(), "timed_out");
        assert_eq!(ClickStatus::Interrupted.to_string(), "interrupted");
        assert_eq!(ClickEffect::NotObserved.to_string(), "not-observed");
        assert_eq!(ClickEffect::Contradicted.to_string(), "contradicted");
    }

    #[test]
    fn action_ids_are_unique_per_click() {
        let a = next_action_id();
        let b = next_action_id();
        assert_ne!(a, b);
        assert!(a.starts_with("click-"));
    }

    #[test]
    fn evidence_carries_structured_detail() {
        let item = Evidence::new("element-state", json!({"key": "checked", "after": true}));
        assert_eq!(item.kind, "element-state");
        assert_eq!(item.detail["key"], "checked");
    }
}
