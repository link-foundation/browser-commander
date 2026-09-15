//! Orthogonal click activation options.
//!
//! `no_auto_scroll: true` used to be translated into the engine's "force" flag,
//! which skips actionability checks but still scrolls the element into view. The
//! option therefore promised something the engine never delivered. These three
//! axes are independent and each one means exactly what it says:
//!
//! - [`ClickActivation`]: how the click is delivered (pointer or DOM)
//! - [`ClickScroll`]: what may happen to the scroll position
//! - [`ClickActionability`]: whether engine pre-checks are skipped

use std::fmt;

use serde_json::{json, Value};

use crate::core::engine::{EngineAdapter, EngineError};

/// How the click is delivered to the element.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ClickActivation {
    /// Real pointer input at the element's click point.
    #[default]
    Pointer,
    /// `HTMLElement.click()` - an untrusted event that skips pointer handlers.
    Dom,
}

impl fmt::Display for ClickActivation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Pointer => "pointer",
            Self::Dom => "dom",
        };
        write!(f, "{text}")
    }
}

/// What the click is allowed to do to the scroll position.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ClickScroll {
    /// Let the engine scroll the element into view (default).
    #[default]
    Auto,
    /// Allow scrolling, then restore the original scroll position.
    Preserve,
    /// Never scroll; fail if the click cannot be delivered without scrolling.
    None,
}

impl fmt::Display for ClickScroll {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Auto => "auto",
            Self::Preserve => "preserve",
            Self::None => "none",
        };
        write!(f, "{text}")
    }
}

/// Whether the engine's actionability pre-checks run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ClickActionability {
    /// Run the engine's pre-checks.
    #[default]
    Normal,
    /// Skip engine pre-checks. Does **not** disable scrolling.
    Force,
}

impl fmt::Display for ClickActionability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let text = match self {
            Self::Normal => "normal",
            Self::Force => "force",
        };
        write!(f, "{text}")
    }
}

/// Resolved activation options.
#[derive(Debug, Clone, Default)]
pub struct ActivationOptions {
    /// How the click is delivered.
    pub activation: ClickActivation,
    /// What may happen to the scroll position.
    pub scroll: ClickScroll,
    /// Whether engine pre-checks are skipped.
    pub actionability: ClickActionability,
    /// Deprecation notices raised while resolving.
    pub deprecations: Vec<String>,
}

/// The deprecation notice raised for `no_auto_scroll`.
pub const NO_AUTO_SCROLL_DEPRECATION: &str =
    "no_auto_scroll is deprecated; use scroll = ClickScroll::None (no scrolling at all) \
     or actionability = ClickActionability::Force (skip engine pre-checks, scrolling still allowed)";

impl ActivationOptions {
    /// Resolve the deprecated `no_auto_scroll` flag onto the new axes.
    ///
    /// `no_auto_scroll` asked for "do not scroll", so it maps to
    /// [`ClickScroll::None`] - the axis that actually delivers that - and not to
    /// the force flag it used to be routed through.
    #[must_use]
    pub fn from_no_auto_scroll(no_auto_scroll: bool) -> Self {
        Self {
            scroll: if no_auto_scroll {
                ClickScroll::None
            } else {
                ClickScroll::Auto
            },
            deprecations: vec![NO_AUTO_SCROLL_DEPRECATION.to_string()],
            ..Self::default()
        }
    }
}

/// Why a click could not be dispatched.
#[derive(Debug, thiserror::Error)]
pub enum ClickDispatchError {
    /// `ClickScroll::None` was requested but cannot be honored.
    ///
    /// Failing loudly is the point: the previous behavior scrolled anyway and
    /// reported success, so callers who needed the viewport to stay put had no
    /// way to find out that it had moved.
    #[error("{message}")]
    ScrollConstraint {
        /// Human-readable explanation with a suggested alternative.
        message: String,
        /// Structured detail (geometry and hit-test result).
        detail: Value,
    },

    /// The engine itself failed.
    #[error(transparent)]
    Engine(#[from] EngineError),
}

/// The click point of an element and whether it can be reached right now.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClickPoint {
    /// Viewport x coordinate of the element's centre.
    pub x: f64,
    /// Viewport y coordinate of the element's centre.
    pub y: f64,
    /// Whether the centre lies inside the viewport.
    pub in_viewport: bool,
    /// Whether a hit test at the centre lands on the target.
    pub hits_target: bool,
    /// The raw measurement, kept as evidence.
    pub raw: Value,
}

/// A window scroll offset.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScrollPosition {
    /// Horizontal offset.
    pub x: f64,
    /// Vertical offset.
    pub y: f64,
}

/// What the dispatch actually did.
#[derive(Debug, Clone, Default)]
pub struct DispatchDetail {
    /// Which activation mode delivered the click.
    pub mode: ClickActivation,
    /// Scroll position before the click, when it could be read.
    pub scroll_before: Option<ScrollPosition>,
    /// Scroll position after the click, when it could be read.
    pub scroll_after: Option<ScrollPosition>,
    /// The measured click point, for `ClickScroll::None`.
    pub point: Option<ClickPoint>,
}

impl DispatchDetail {
    /// Whether the scroll position moved across the click.
    ///
    /// Returns `None` when either reading failed, because "we could not tell"
    /// is not the same answer as "it did not move".
    #[must_use]
    pub fn scroll_changed(&self) -> Option<bool> {
        match (self.scroll_before, self.scroll_after) {
            (Some(before), Some(after)) => Some(before.x != after.x || before.y != after.y),
            _ => None,
        }
    }
}

const READ_SCROLL_JS: &str = "(() => ({x: window.scrollX, y: window.scrollY}))()";

fn click_point_js(selector: &str) -> String {
    format!(
        r#"(() => {{
            const el = document.querySelector({});
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const inViewport = rect.width > 0 && rect.height > 0 &&
                x >= 0 && y >= 0 &&
                x <= window.innerWidth && y <= window.innerHeight;
            const hit = inViewport ? document.elementFromPoint(x, y) : null;
            return {{
                x, y,
                width: rect.width, height: rect.height,
                top: rect.top, left: rect.left,
                viewport: {{width: window.innerWidth, height: window.innerHeight}},
                scroll: {{x: window.scrollX, y: window.scrollY}},
                inViewport,
                hitsTarget: Boolean(hit && (hit === el || el.contains(hit))),
            }};
        }})()"#,
        json_selector(selector)
    )
}

fn dom_click_js(selector: &str) -> String {
    format!(
        "(() => {{ const el = document.querySelector({}); \
         if (!el) return false; el.click(); return true; }})()",
        json_selector(selector)
    )
}

fn restore_scroll_js(position: ScrollPosition) -> String {
    format!("(() => window.scrollTo({}, {}))()", position.x, position.y)
}

fn json_selector(selector: &str) -> String {
    serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".to_string())
}

fn scroll_from_value(value: &Value) -> Option<ScrollPosition> {
    Some(ScrollPosition {
        x: value.get("x")?.as_f64()?,
        y: value.get("y")?.as_f64()?,
    })
}

/// Measure an element's click point and whether it is reachable right now.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
///
/// # Returns
///
/// The geometry and hit-test result, or [`EngineError::ElementNotFound`].
pub async fn measure_click_point(
    adapter: &dyn EngineAdapter,
    selector: &str,
) -> Result<ClickPoint, EngineError> {
    let value = adapter.evaluate(&click_point_js(selector)).await?;

    if value.is_null() {
        return Err(EngineError::ElementNotFound(selector.to_string()));
    }

    Ok(ClickPoint {
        x: value.get("x").and_then(Value::as_f64).unwrap_or(0.0),
        y: value.get("y").and_then(Value::as_f64).unwrap_or(0.0),
        in_viewport: value
            .get("inViewport")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        hits_target: value
            .get("hitsTarget")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        raw: value,
    })
}

/// Read the current window scroll position.
///
/// Scroll position is evidence, not a precondition, so a failure to read it
/// yields `None` rather than failing the click.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
///
/// # Returns
///
/// The scroll offsets, or `None` when they could not be read.
pub async fn read_scroll_position(adapter: &dyn EngineAdapter) -> Option<ScrollPosition> {
    let value = adapter.evaluate(READ_SCROLL_JS).await.ok()?;
    scroll_from_value(&value)
}

/// Restore a previously captured scroll position.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `position` - The position to restore, if one was captured
///
/// # Returns
///
/// Nothing on success.
pub async fn restore_scroll_position(
    adapter: &dyn EngineAdapter,
    position: Option<ScrollPosition>,
) -> Result<(), EngineError> {
    let Some(position) = position else {
        return Ok(());
    };
    adapter.evaluate(&restore_scroll_js(position)).await?;
    Ok(())
}

async fn dispatch_pointer_without_scrolling(
    adapter: &dyn EngineAdapter,
    selector: &str,
) -> Result<DispatchDetail, ClickDispatchError> {
    let point = measure_click_point(adapter, selector).await?;

    if !point.in_viewport {
        return Err(ClickDispatchError::ScrollConstraint {
            message: "scroll = ClickScroll::None was requested but the element is outside \
                      the viewport, so a real pointer click cannot reach it without scrolling. \
                      Use ClickScroll::Preserve to scroll and restore, ClickScroll::Auto to \
                      allow scrolling, or ClickActivation::Dom to dispatch an untrusted click."
                .to_string(),
            detail: point.raw,
        });
    }

    if !point.hits_target {
        return Err(ClickDispatchError::ScrollConstraint {
            message: "scroll = ClickScroll::None was requested but another element covers \
                      the target at its click point, so a real pointer click would hit the \
                      wrong element."
                .to_string(),
            detail: point.raw,
        });
    }

    let scroll_before = read_scroll_position(adapter).await;
    adapter
        .mouse_click(point.x, point.y)
        .await
        .map_err(|error| {
            // An engine with no pointer API cannot honor the constraint at all, so
            // report it as a refused constraint rather than a generic failure.
            ClickDispatchError::ScrollConstraint {
                message: format!(
                    "scroll = ClickScroll::None needs viewport-coordinate pointer input: {error}"
                ),
                detail: json!({ "reason": "engine has no pointer API" }),
            }
        })?;

    Ok(DispatchDetail {
        mode: ClickActivation::Pointer,
        scroll_before,
        scroll_after: read_scroll_position(adapter).await,
        point: Some(point),
    })
}

/// Deliver a click according to the resolved activation options.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
/// * `options` - The resolved activation options
///
/// # Returns
///
/// What the dispatch did, or [`ClickDispatchError::ScrollConstraint`] when
/// `ClickScroll::None` cannot be honored.
pub async fn dispatch_click(
    adapter: &dyn EngineAdapter,
    selector: &str,
    options: &ActivationOptions,
) -> Result<DispatchDetail, ClickDispatchError> {
    if options.activation == ClickActivation::Dom {
        let scroll_before = read_scroll_position(adapter).await;
        let clicked = adapter.evaluate(&dom_click_js(selector)).await?;
        if clicked == Value::Bool(false) {
            return Err(EngineError::ElementNotFound(selector.to_string()).into());
        }
        return Ok(DispatchDetail {
            mode: ClickActivation::Dom,
            scroll_before,
            scroll_after: read_scroll_position(adapter).await,
            point: None,
        });
    }

    if options.scroll == ClickScroll::None {
        return dispatch_pointer_without_scrolling(adapter, selector).await;
    }

    let scroll_before = read_scroll_position(adapter).await;
    adapter.click(selector).await?;

    if options.scroll == ClickScroll::Preserve {
        restore_scroll_position(adapter, scroll_before).await?;
    }

    Ok(DispatchDetail {
        mode: ClickActivation::Pointer,
        scroll_before,
        scroll_after: read_scroll_position(adapter).await,
        point: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_scroll_and_never_force() {
        let options = ActivationOptions::default();
        assert_eq!(options.activation, ClickActivation::Pointer);
        assert_eq!(options.scroll, ClickScroll::Auto);
        assert_eq!(options.actionability, ClickActionability::Normal);
        assert!(options.deprecations.is_empty());
    }

    #[test]
    fn no_auto_scroll_maps_to_scroll_none_not_to_force() {
        // Regression test for issue #89: the flag used to be routed through the
        // engine's force option, which does not disable scrolling.
        let options = ActivationOptions::from_no_auto_scroll(true);
        assert_eq!(options.scroll, ClickScroll::None);
        assert_eq!(options.actionability, ClickActionability::Normal);
        assert_eq!(options.deprecations, vec![NO_AUTO_SCROLL_DEPRECATION]);
    }

    #[test]
    fn no_auto_scroll_false_allows_scrolling() {
        let options = ActivationOptions::from_no_auto_scroll(false);
        assert_eq!(options.scroll, ClickScroll::Auto);
    }

    #[test]
    fn axes_render_the_documented_names() {
        assert_eq!(ClickActivation::Dom.to_string(), "dom");
        assert_eq!(ClickScroll::Preserve.to_string(), "preserve");
        assert_eq!(ClickActionability::Force.to_string(), "force");
    }

    #[test]
    fn scroll_changed_reports_unknown_when_a_reading_is_missing() {
        let mut detail = DispatchDetail {
            scroll_before: Some(ScrollPosition { x: 0.0, y: 0.0 }),
            ..DispatchDetail::default()
        };
        assert_eq!(detail.scroll_changed(), None);

        detail.scroll_after = Some(ScrollPosition { x: 0.0, y: 0.0 });
        assert_eq!(detail.scroll_changed(), Some(false));

        detail.scroll_after = Some(ScrollPosition { x: 0.0, y: 3911.0 });
        assert_eq!(detail.scroll_changed(), Some(true));
    }

    #[test]
    fn selectors_are_json_escaped_into_the_probe() {
        let script = click_point_js("button[data-id='a\"b']");
        assert!(script.contains(r#"document.querySelector("button[data-id='a\"b']")"#));
    }
}
