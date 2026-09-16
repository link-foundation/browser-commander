//! Click operations for browser automation.
//!
//! This module provides utilities for clicking elements with
//! pre-click state capture and verification support.
//!
//! Verification reports what it *observed*. An element that is still present
//! and unchanged is not evidence that the click did anything - that is exactly
//! the case of a button whose handler is missing or threw - so it is reported
//! as [`ClickEffect::NotObserved`] rather than as success.

use serde_json::json;

use crate::core::constants::TIMING;
use crate::core::engine::{ClickVerificationResult, EngineAdapter, EngineError, PreClickState};
use crate::core::navigation::is_navigation_error;
use crate::core::readiness::{run_within_deadline, Deadline, DeadlineOutcome};
use crate::interactions::click_activation::{
    dispatch_click, ActivationOptions, ClickActivation, ClickDispatchError, ClickScroll,
    DispatchDetail,
};
use crate::interactions::click_result::{
    next_action_id, ClickEffect, ClickResult, ClickStatus, Evidence,
};
use crate::interactions::scroll::{scroll_into_view_if_needed, ScrollBehavior, ScrollOptions};
use std::time::Duration;

/// Options for click operations.
#[derive(Debug, Clone)]
pub struct ClickOptions {
    /// Whether to scroll the element into view before clicking.
    pub scroll_into_view: bool,
    /// Scroll behavior (smooth or instant).
    pub scroll_behavior: ScrollBehavior,
    /// Wait time after scrolling.
    pub wait_after_scroll: Duration,
    /// Wait time after clicking.
    pub wait_after_click: Duration,
    /// Whether to verify the click operation.
    pub verify: bool,
    /// Timeout for the click operation.
    pub timeout: Duration,
    /// How the click is delivered, what it may scroll, and whether engine
    /// pre-checks run. These three axes are independent of each other.
    pub activation: ActivationOptions,
}

impl Default for ClickOptions {
    fn default() -> Self {
        Self {
            scroll_into_view: true,
            scroll_behavior: ScrollBehavior::Smooth,
            wait_after_scroll: TIMING.default_wait_after_scroll,
            wait_after_click: Duration::from_millis(1000),
            verify: true,
            timeout: TIMING.default_timeout,
            activation: ActivationOptions::default(),
        }
    }
}

impl ClickOptions {
    /// Whether this configuration forbids the page from scrolling.
    fn forbids_scrolling(&self) -> bool {
        self.activation.scroll == ClickScroll::None
    }
}

fn state_probe_js(selector: &str) -> String {
    format!(
        r#"
        (function() {{
            const el = document.querySelector({});
            if (!el) return null;
            return {{
                disabled: el.disabled || false,
                ariaPressed: el.getAttribute('aria-pressed'),
                ariaExpanded: el.getAttribute('aria-expanded'),
                ariaSelected: el.getAttribute('aria-selected'),
                checked: el.checked || false,
                className: el.className || '',
                isConnected: el.isConnected
            }};
        }})()
        "#,
        serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".to_string())
    )
}

/// Capture the pre-click state of an element for verification.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
///
/// # Returns
///
/// The pre-click state of the element
pub async fn capture_pre_click_state(
    adapter: &dyn EngineAdapter,
    selector: &str,
) -> Result<PreClickState, EngineError> {
    let result = adapter.evaluate(&state_probe_js(selector)).await?;

    if result.is_null() {
        return Ok(PreClickState::default());
    }

    Ok(PreClickState {
        disabled: result.get("disabled").and_then(|v| v.as_bool()),
        aria_pressed: result
            .get("ariaPressed")
            .and_then(|v| v.as_str())
            .map(String::from),
        aria_expanded: result
            .get("ariaExpanded")
            .and_then(|v| v.as_str())
            .map(String::from),
        aria_selected: result
            .get("ariaSelected")
            .and_then(|v| v.as_str())
            .map(String::from),
        checked: result.get("checked").and_then(|v| v.as_bool()),
        class_name: result
            .get("className")
            .and_then(|v| v.as_str())
            .map(String::from),
        is_connected: result
            .get("isConnected")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

/// Compare one observed property, returning evidence when it changed.
fn changed(
    key: &str,
    reason: &str,
    before: serde_json::Value,
    after: serde_json::Value,
) -> Option<ClickVerificationResult> {
    if before == after {
        return None;
    }
    Some(ClickVerificationResult::confirmed(
        reason,
        vec![Evidence::new(
            "element-state",
            json!({"key": key, "before": before, "after": after}),
        )],
    ))
}

/// Whether any pre-click state was captured at all.
///
/// A default-constructed state means the probe found nothing, so there is
/// nothing to compare against and no change can honestly be claimed.
fn has_pre_state(state: &PreClickState) -> bool {
    state.is_connected
        || state.disabled.is_some()
        || state.aria_pressed.is_some()
        || state.aria_expanded.is_some()
        || state.aria_selected.is_some()
        || state.checked.is_some()
        || state.class_name.is_some()
}

/// Verify a click operation by comparing pre and post-click states.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `pre_click_state` - The state captured before the click
///
/// # Returns
///
/// The verification result. Note that an unchanged, still-connected element
/// yields [`ClickEffect::NotObserved`]: presence is not proof of effect.
pub async fn verify_click(
    adapter: &dyn EngineAdapter,
    selector: &str,
    pre_click_state: &PreClickState,
) -> Result<ClickVerificationResult, EngineError> {
    let post_click_state = match capture_pre_click_state(adapter, selector).await {
        Ok(state) => state,
        Err(e) if is_navigation_error(&e.to_string()) => {
            // The execution context went away. That is consistent with the
            // click having navigated the page, but equally consistent with an
            // unrelated navigation already in flight. Verification is simply
            // unavailable; attributing the navigation is the caller's job.
            return Ok(ClickVerificationResult::not_observed(
                "verification unavailable: execution context was destroyed during verification",
                vec![Evidence::message("verification-unavailable", e.to_string())],
            )
            .with_navigation_error(true));
        }
        Err(e) => return Err(e),
    };

    let had_pre_state = has_pre_state(pre_click_state);

    if had_pre_state {
        let comparisons = [
            changed(
                "ariaPressed",
                "aria-pressed changed",
                json!(pre_click_state.aria_pressed),
                json!(post_click_state.aria_pressed),
            ),
            changed(
                "ariaExpanded",
                "aria-expanded changed",
                json!(pre_click_state.aria_expanded),
                json!(post_click_state.aria_expanded),
            ),
            changed(
                "ariaSelected",
                "aria-selected changed",
                json!(pre_click_state.aria_selected),
                json!(post_click_state.aria_selected),
            ),
            changed(
                "checked",
                "checked state changed",
                json!(pre_click_state.checked),
                json!(post_click_state.checked),
            ),
            changed(
                "className",
                "className changed",
                json!(pre_click_state.class_name),
                json!(post_click_state.class_name),
            ),
            changed(
                "disabled",
                "disabled state changed",
                json!(pre_click_state.disabled),
                json!(post_click_state.disabled),
            ),
        ];

        if let Some(result) = comparisons.into_iter().flatten().next() {
            return Ok(result);
        }
    }

    if !post_click_state.is_connected {
        // Detachment is a real, observable change in the document.
        return Ok(ClickVerificationResult::confirmed(
            "element removed from DOM (UI updated)",
            vec![Evidence::new(
                "element-state",
                json!({"key": "isConnected", "after": false}),
            )],
        ));
    }

    let reason = if had_pre_state {
        "no observable change to the target element after the click"
    } else {
        "no pre-click state captured, so no change could be observed"
    };

    Ok(ClickVerificationResult::not_observed(
        reason,
        vec![Evidence::new(
            "element-state",
            json!({"unchanged": true, "hasPreState": had_pre_state}),
        )],
    ))
}

fn dispatch_evidence(options: &ClickOptions, dispatch: &DispatchDetail) -> Vec<Evidence> {
    let scroll_of = |position: Option<crate::interactions::click_activation::ScrollPosition>| {
        position.map(|p| json!({"x": p.x, "y": p.y}))
    };

    let mut evidence = vec![Evidence::new(
        "dispatch",
        json!({
            "mode": dispatch.mode.to_string(),
            "activation": options.activation.activation.to_string(),
            "scroll": options.activation.scroll.to_string(),
            "actionability": options.activation.actionability.to_string(),
            "scrollBefore": scroll_of(dispatch.scroll_before),
            "scrollAfter": scroll_of(dispatch.scroll_after),
            "scrollChanged": dispatch.scroll_changed(),
            "point": dispatch.point.as_ref().map(|p| p.raw.clone()),
        }),
    )];

    if options.activation.scroll != ClickScroll::Auto && dispatch.scroll_changed() == Some(true) {
        // We did not scroll, but the page reacted by scrolling itself. Record
        // it so callers asserting on viewport stability can see what moved.
        evidence.push(Evidence::new(
            "page-scrolled-itself",
            json!({
                "before": scroll_of(dispatch.scroll_before),
                "after": scroll_of(dispatch.scroll_after),
            }),
        ));
    }

    evidence
}

/// Click an element (low-level operation).
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `options` - Click options
///
/// # Returns
///
/// The result of the click operation. The result reports what was observed:
/// a dispatched click whose effect nothing confirmed is
/// [`ClickStatus::Unverified`], not a success.
pub async fn click_element(
    adapter: &dyn EngineAdapter,
    selector: &str,
    options: &ClickOptions,
) -> Result<ClickResult, EngineError> {
    // One monotonic budget covers probing, dispatch and verification, so a
    // click cannot quietly cost several times the timeout the caller asked for.
    let deadline = Deadline::new(options.timeout);
    let action_id = next_action_id();
    let elapsed = || deadline.elapsed_ms();

    // Capture pre-click state for verification. A state that could not be read
    // in time is no state at all; the click then has nothing to compare
    // against and says so rather than guessing.
    let pre_click_state = if options.verify {
        run_within_deadline(&deadline, capture_pre_click_state(adapter, selector))
            .await
            .value()
            .transpose()?
            .unwrap_or_default()
    } else {
        PreClickState::default()
    };

    // A navigation replaces the document the element lived in, and engines
    // answer an element probe on the *new* document instead of failing. Reading
    // the URL first is what lets the result tell those two cases apart.
    let url_before_dispatch = adapter.url().await.ok();

    // Dispatch is bounded too: locating a click point and reading the scroll
    // position are engine round-trips, and an unbounded one spends the budget
    // the caller reserved for the whole click.
    let dispatched = run_within_deadline(
        &deadline,
        dispatch_click(adapter, selector, &options.activation),
    )
    .await;

    let DeadlineOutcome::Completed(dispatched) = dispatched else {
        return Ok(ClickResult::new(
            ClickStatus::TimedOut,
            false,
            ClickEffect::NotObserved,
            "click budget expired before the click could be dispatched",
        )
        .with_evidence(vec![Evidence::new(
            "dispatch-timeout",
            json!({
                "timeoutMs": options.timeout.as_millis(),
                "elapsedMs": deadline.elapsed_ms(),
            }),
        )])
        .with_elapsed_ms(elapsed())
        .with_action_id(action_id));
    };

    let dispatch = match dispatched {
        Ok(detail) => detail,
        Err(ClickDispatchError::ScrollConstraint { message, detail }) => {
            // The caller asked for no scrolling and the click cannot be
            // delivered without it. Say so instead of scrolling behind their
            // back and reporting success.
            return Ok(ClickResult::new(
                ClickStatus::Failed,
                false,
                ClickEffect::NotObserved,
                message,
            )
            .with_evidence(vec![Evidence::new("scroll-constraint", detail)])
            .with_elapsed_ms(elapsed())
            .with_action_id(action_id));
        }
        Err(ClickDispatchError::Engine(e)) if is_navigation_error(&e.to_string()) => {
            return Ok(ClickResult::navigation(
                "navigation or stop interrupted the click before it could be observed",
            )
            .with_evidence(vec![Evidence::message("interrupted", e.to_string())])
            .with_elapsed_ms(elapsed())
            .with_action_id(action_id));
        }
        Err(ClickDispatchError::Engine(e)) => return Err(e),
    };

    let mut evidence = dispatch_evidence(options, &dispatch);

    if !options.verify {
        return Ok(
            ClickResult::unverified("click dispatched; verification not requested")
                .with_evidence(evidence)
                .with_elapsed_ms(elapsed())
                .with_action_id(action_id),
        );
    }

    let verification = match verify_until_navigation(
        adapter,
        selector,
        &pre_click_state,
        url_before_dispatch.as_deref(),
        &deadline,
    )
    .await?
    {
        VerificationOutcome::Verified(verification) => verification,
        VerificationOutcome::Navigated(to) => {
            // The document the element belonged to is gone, so there is nothing
            // left to observe. The navigation is recorded as what it is - a
            // correlated event - and *not* as proof that this click caused it.
            evidence.push(Evidence::new(
                "navigation",
                json!({
                    "actionId": action_id,
                    "from": url_before_dispatch,
                    "to": to,
                    "correlated": true,
                    "provesClickEffect": false,
                }),
            ));

            return Ok(ClickResult::new(
                ClickStatus::Unverified,
                true,
                ClickEffect::NotObserved,
                "the page navigated after the click, so the click effect could not be \
                 observed on the original document",
            )
            .with_navigated(true)
            .with_evidence(evidence)
            .with_elapsed_ms(elapsed())
            .with_action_id(action_id));
        }
        VerificationOutcome::TimedOut => {
            evidence.push(Evidence::new(
                "verification-timeout",
                json!({
                    "timeoutMs": options.timeout.as_millis(),
                    "elapsedMs": deadline.elapsed_ms(),
                }),
            ));

            // The click was delivered either way; only the observation ran out
            // of time, and `timed_out` says that rather than blaming the click.
            return Ok(ClickResult::new(
                ClickStatus::TimedOut,
                true,
                ClickEffect::NotObserved,
                "verification budget expired before an effect could be observed",
            )
            .with_evidence(evidence)
            .with_elapsed_ms(elapsed())
            .with_action_id(action_id));
        }
    };

    let confirmed = verification.effect == ClickEffect::Confirmed;
    evidence.extend(verification.evidence);

    Ok(ClickResult::new(
        if confirmed {
            ClickStatus::Succeeded
        } else {
            ClickStatus::Unverified
        },
        true,
        verification.effect,
        verification.reason,
    )
    .with_navigated(verification.navigation_error)
    .with_evidence(evidence)
    .with_elapsed_ms(elapsed())
    .with_action_id(action_id))
}

/// How far verification got before something ended it.
enum VerificationOutcome {
    /// Verification produced a verdict.
    Verified(ClickVerificationResult),
    /// The page navigated away, carrying the URL it went to.
    Navigated(String),
    /// The budget ran out before anything could be observed.
    TimedOut,
}

/// How often the navigation watch samples the page URL.
const NAVIGATION_POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Poll the page URL until it changes, or until the budget runs out.
async fn watch_for_navigation(
    adapter: &dyn EngineAdapter,
    url_before: &str,
    deadline: &Deadline,
) -> String {
    loop {
        deadline.sleep_at_most(NAVIGATION_POLL_INTERVAL).await;
        if let Ok(now) = adapter.url().await {
            if now != url_before {
                return now;
            }
        }
        if deadline.expired() {
            // Let the verification side of the race report the timeout, so a
            // spent budget is described once and in one vocabulary.
            std::future::pending::<()>().await;
        }
    }
}

/// Verify a click, giving up as soon as the page navigates away.
///
/// Without the navigation watch a navigating click spends its whole budget on
/// a probe the engine happily answers against the *new* document, and the
/// result then reports a timeout for what was really a navigation.
async fn verify_until_navigation(
    adapter: &dyn EngineAdapter,
    selector: &str,
    pre_click_state: &PreClickState,
    url_before: Option<&str>,
    deadline: &Deadline,
) -> Result<VerificationOutcome, EngineError> {
    let verifying = verify_click(adapter, selector, pre_click_state);

    let Some(url_before) = url_before else {
        return match run_within_deadline(deadline, verifying).await {
            DeadlineOutcome::Completed(result) => Ok(VerificationOutcome::Verified(result?)),
            DeadlineOutcome::TimedOut => Ok(VerificationOutcome::TimedOut),
        };
    };

    let raced = async {
        tokio::select! {
            result = verifying => result.map(VerificationOutcome::Verified),
            to = watch_for_navigation(adapter, url_before, deadline) => {
                Ok(VerificationOutcome::Navigated(to))
            }
        }
    };

    match run_within_deadline(deadline, raced).await {
        DeadlineOutcome::Completed(outcome) => outcome,
        DeadlineOutcome::TimedOut => Ok(VerificationOutcome::TimedOut),
    }
}

/// Click a button or element (high-level with scrolling and waits).
///
/// This function handles:
/// - Scrolling the element into view
/// - Clicking the element
/// - Verifying the click
/// - Waiting for any triggered navigation
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `options` - Click options
///
/// # Returns
///
/// The result of the click operation
pub async fn click_button(
    adapter: &dyn EngineAdapter,
    selector: &str,
    options: &ClickOptions,
) -> Result<ClickResult, EngineError> {
    // Scrolling, clicking, verifying and the settle wait all come out of one
    // budget; before it was shared, each started a timer of its own and a
    // button click could cost several times the timeout the caller asked for.
    let deadline = Deadline::new(options.timeout);

    // Scroll into view if requested. `ClickScroll::None` means what it says, so
    // it overrides the legacy `scroll_into_view` flag instead of being silently
    // undone by it.
    if options.scroll_into_view
        && !options.forbids_scrolling()
        && options.activation.activation != ClickActivation::Dom
    {
        let scroll_options = ScrollOptions {
            behavior: options.scroll_behavior,
            wait_after_scroll: options.wait_after_scroll,
            ..Default::default()
        };

        match scroll_into_view_if_needed(adapter, selector, &scroll_options).await {
            Ok(_) => {}
            Err(e) if is_navigation_error(&e.to_string()) => {
                return Ok(ClickResult::navigation("navigation during scroll"));
            }
            Err(e) => return Err(e),
        }
    }

    // Perform the click with whatever is left of the shared budget.
    let remaining = ClickOptions {
        timeout: deadline.remaining(),
        ..options.clone()
    };
    let result = click_element(adapter, selector, &remaining).await?;

    // Wait after click if specified
    if result.dispatched {
        deadline.sleep_at_most(options.wait_after_click).await;
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::stub_engine::StubEngine;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Instant;

    /// A budget far shorter than any engine's own probe timeout.
    const MS_150: Duration = Duration::from_millis(150);

    #[test]
    fn click_options_default() {
        let options = ClickOptions::default();
        assert!(options.scroll_into_view);
        assert_eq!(options.scroll_behavior, ScrollBehavior::Smooth);
        assert!(options.verify);
        assert_eq!(options.activation.scroll, ClickScroll::Auto);
    }

    #[test]
    fn no_auto_scroll_forbids_the_pre_click_scroll() {
        // Regression test for issue #89: the "do not scroll" request used to be
        // mapped onto the engine's force flag, which still scrolls, and the
        // high-level helper scrolled before the click on top of that.
        let options = ClickOptions {
            activation: ActivationOptions::from_no_auto_scroll(true),
            ..ClickOptions::default()
        };
        assert!(options.scroll_into_view);
        assert!(options.forbids_scrolling());
    }

    #[test]
    fn click_result_success() {
        let result = ClickResult::success("element clicked");
        assert!(result.clicked);
        assert!(result.verified);
        assert!(!result.navigated);
        assert_eq!(result.reason, "element clicked");
    }

    #[test]
    fn click_result_navigation() {
        // Regression test for issue #89: this used to report `verified: true`.
        let result = ClickResult::navigation("page navigated");
        assert!(!result.clicked);
        assert!(!result.verified);
        assert!(result.navigated);
        assert_eq!(result.status, ClickStatus::Interrupted);
    }

    #[test]
    fn click_result_failed() {
        let result = ClickResult::failed("element not found");
        assert!(!result.clicked);
        assert!(!result.verified);
        assert!(!result.navigated);
    }

    #[test]
    fn pre_click_state_default() {
        let state = PreClickState::default();
        assert!(state.disabled.is_none());
        assert!(state.aria_pressed.is_none());
        assert!(!state.is_connected);
        assert!(!has_pre_state(&state));
    }

    #[test]
    fn unchanged_element_is_not_evidence_of_an_effect() {
        // Regression test for issue #89: a no-op button left the element
        // connected and unchanged, and that was reported as success.
        assert!(changed(
            "checked",
            "checked state changed",
            json!(false),
            json!(false)
        )
        .is_none());
    }

    #[test]
    fn a_changed_property_is_confirmed_with_evidence() {
        let result = changed(
            "checked",
            "checked state changed",
            json!(false),
            json!(true),
        )
        .expect("a change should be reported");
        assert!(result.verified);
        assert_eq!(result.effect, ClickEffect::Confirmed);
        assert_eq!(result.evidence[0].detail["before"], json!(false));
        assert_eq!(result.evidence[0].detail["after"], json!(true));
    }

    /// The element state a probe reports for an untouched, connected button.
    fn unchanged_state() -> serde_json::Value {
        json!({
            "disabled": false,
            "ariaPressed": "false",
            "checked": false,
            "className": "btn",
            "isConnected": true,
        })
    }

    /// Answer the pre-click state probe, then stall every later one.
    ///
    /// This is what a real engine does after a navigation: it serves the probe
    /// against the new document, or waits out its own locator timeout, rather
    /// than reporting that the element is gone. Only the element-state probe is
    /// stalled, so dispatch still reaches the page.
    fn stalls_after_the_first_state_probe() -> impl Fn(usize, &str) -> Duration + Send + Sync {
        let state_probes = AtomicUsize::new(0);

        move |_call, script| {
            if !script.contains("isConnected") {
                return Duration::ZERO;
            }
            if state_probes.fetch_add(1, Ordering::SeqCst) == 0 {
                Duration::ZERO
            } else {
                Duration::from_secs(30)
            }
        }
    }

    /// Click options that verify, with a short budget and no settle wait.
    fn verifying_within(timeout: Duration) -> ClickOptions {
        ClickOptions {
            verify: true,
            timeout,
            wait_after_click: Duration::ZERO,
            ..ClickOptions::default()
        }
    }

    #[tokio::test]
    async fn reports_timed_out_when_the_target_cannot_be_read() {
        // Regression test for issue #89: the probe used to run under the
        // engine's own timeout, so a click given 150ms could wait 30 seconds
        // and then blame the click for being slow.
        let adapter = StubEngine::fixed("https://example.com/start")
            .evaluating(|_| unchanged_state())
            .evaluating_slowly(stalls_after_the_first_state_probe());

        let started = Instant::now();
        let result = click_element(&adapter, "#target", &verifying_within(MS_150))
            .await
            .expect("a slow probe is not an engine error");

        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the budget, not the probe, has to end the wait"
        );
        assert_eq!(result.status, ClickStatus::TimedOut);
        assert!(result.dispatched);
        assert_eq!(result.effect, ClickEffect::NotObserved);
        assert!(!result.verified);
        assert!(result
            .evidence
            .iter()
            .any(|item| item.kind == "verification-timeout"));
    }

    #[tokio::test]
    async fn gives_up_on_a_target_the_page_navigated_away_from() {
        // The first `url()` call is the one taken before dispatch; every later
        // one is the navigation watch, which must see the page has moved.
        let adapter = StubEngine::scripted(|call| {
            if call == 0 {
                "https://example.com/start".to_string()
            } else {
                "https://example.com/arrived".to_string()
            }
        })
        .evaluating(|_| unchanged_state())
        .evaluating_slowly(stalls_after_the_first_state_probe());

        let started = Instant::now();
        let result = click_element(&adapter, "#go", &verifying_within(Duration::from_secs(5)))
            .await
            .expect("a navigation is not an engine error");

        assert!(
            started.elapsed() < Duration::from_secs(2),
            "the navigation, not the budget, should end the wait"
        );
        assert_eq!(result.status, ClickStatus::Unverified);
        assert_ne!(result.effect, ClickEffect::Confirmed);

        let navigation = result
            .evidence
            .iter()
            .find(|item| item.kind == "navigation")
            .expect("the navigation has to be recorded");
        assert_eq!(navigation.detail["provesClickEffect"], json!(false));
        assert_eq!(
            navigation.detail["to"],
            json!("https://example.com/arrived")
        );
    }

    #[tokio::test]
    async fn keeps_a_button_click_inside_one_budget() {
        // click_button scrolls, clicks, verifies and then waits; before the
        // budget was shared each of those started a timer of its own.
        let adapter = StubEngine::fixed("https://example.com/start")
            .evaluating(|_| unchanged_state())
            .evaluating_slowly(stalls_after_the_first_state_probe());
        let options = ClickOptions {
            wait_after_click: Duration::from_secs(10),
            ..verifying_within(MS_150)
        };

        let started = Instant::now();
        let result = click_button(&adapter, "#target", &options)
            .await
            .expect("a slow probe is not an engine error");

        assert!(
            started.elapsed() < Duration::from_secs(5),
            "a 150ms budget must not become {:?}",
            started.elapsed()
        );
        assert_eq!(result.status, ClickStatus::TimedOut);
    }

    #[test]
    fn dispatch_evidence_records_a_page_that_scrolled_itself() {
        use crate::interactions::click_activation::ScrollPosition;

        let options = ClickOptions {
            activation: ActivationOptions::from_no_auto_scroll(true),
            ..ClickOptions::default()
        };
        let dispatch = DispatchDetail {
            mode: ClickActivation::Pointer,
            scroll_before: Some(ScrollPosition { x: 0.0, y: 0.0 }),
            scroll_after: Some(ScrollPosition { x: 0.0, y: 3911.0 }),
            point: None,
        };

        let evidence = dispatch_evidence(&options, &dispatch);
        assert_eq!(evidence[0].detail["scrollChanged"], json!(true));
        assert_eq!(evidence[1].kind, "page-scrolled-itself");
    }
}
