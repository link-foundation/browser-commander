//! Element visibility utilities.
//!
//! This module provides utilities for checking element visibility
//! and viewport positioning.

use crate::core::engine::{EngineAdapter, EngineError};

/// Options for checking element visibility.
#[derive(Debug, Clone)]
pub struct VisibilityOptions {
    /// The selector for the element to check.
    pub selector: String,
    /// Timeout for visibility check in milliseconds.
    pub timeout_ms: Option<u64>,
}

/// Result of a visibility check.
#[derive(Debug, Clone)]
pub struct VisibilityResult {
    /// Whether the element is visible.
    pub visible: bool,
    /// Whether the element exists in the DOM.
    pub exists: bool,
    /// Whether the element is in the viewport.
    pub in_viewport: bool,
}

/// Check if an element is visible using the provided engine adapter.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
///
/// # Returns
///
/// `true` if the element is visible, `false` otherwise
pub async fn is_visible(adapter: &dyn EngineAdapter, selector: &str) -> Result<bool, EngineError> {
    adapter.is_visible(selector).await
}

/// Check if an element is enabled (for form elements).
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector for the element
///
/// # Returns
///
/// `true` if the element is enabled, `false` otherwise
pub async fn is_enabled(adapter: &dyn EngineAdapter, selector: &str) -> Result<bool, EngineError> {
    adapter.is_enabled(selector).await
}

/// Count the number of elements matching a selector.
///
/// # Arguments
///
/// * `adapter` - The engine adapter to use
/// * `selector` - The CSS selector to count
///
/// # Returns
///
/// The number of matching elements
pub async fn count(adapter: &dyn EngineAdapter, selector: &str) -> Result<usize, EngineError> {
    adapter.count(selector).await
}

/// Calculate if an element is within the viewport.
///
/// # Arguments
///
/// * `bounding_box` - The element's bounding box (x, y, width, height)
/// * `viewport_width` - The viewport width
/// * `viewport_height` - The viewport height
/// * `margin` - Additional margin to consider element visible
///
/// # Returns
///
/// `true` if the element is in the viewport
pub fn is_in_viewport(
    bounding_box: (f64, f64, f64, f64),
    viewport_width: f64,
    viewport_height: f64,
    margin: f64,
) -> bool {
    let (x, y, width, height) = bounding_box;

    // Check if element is at least partially visible with margin
    let in_vertical = y < viewport_height - margin && (y + height) > margin;
    let in_horizontal = x < viewport_width - margin && (x + width) > margin;

    in_vertical && in_horizontal
}

/// Calculate if scrolling is needed to center an element.
///
/// # Arguments
///
/// * `bounding_box` - The element's bounding box (x, y, width, height)
/// * `viewport_height` - The viewport height
/// * `threshold_percent` - Percentage of viewport height to consider "significant"
///
/// # Returns
///
/// `true` if scrolling is needed
pub fn needs_scrolling(
    bounding_box: (f64, f64, f64, f64),
    viewport_height: f64,
    threshold_percent: f64,
) -> bool {
    let (_, y, _, height) = bounding_box;

    let element_center = y + height / 2.0;
    let viewport_center = viewport_height / 2.0;
    let distance_from_center = (element_center - viewport_center).abs();
    let threshold_pixels = (viewport_height * threshold_percent) / 100.0;

    // Check if element is visible and within threshold
    let is_visible = y >= 0.0 && (y + height) <= viewport_height;
    let is_within_threshold = distance_from_center <= threshold_pixels;

    !is_visible || !is_within_threshold
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_in_viewport_fully_visible() {
        // Element in the center of viewport
        assert!(is_in_viewport(
            (100.0, 100.0, 50.0, 50.0),
            800.0,
            600.0,
            0.0
        ));
    }

    #[test]
    fn is_in_viewport_partially_visible() {
        // Element partially visible at the edge (right side visible)
        // x=60, so right edge is at 110, which is > margin of 50
        assert!(is_in_viewport(
            (60.0, 100.0, 50.0, 50.0),
            800.0,
            600.0,
            50.0
        ));
        // Element partially visible at left edge (without margin requirement)
        assert!(is_in_viewport(
            (-10.0, 100.0, 50.0, 50.0),
            800.0,
            600.0,
            0.0
        ));
    }

    #[test]
    fn is_in_viewport_not_visible() {
        // Element completely above viewport
        assert!(!is_in_viewport(
            (100.0, -200.0, 50.0, 50.0),
            800.0,
            600.0,
            50.0
        ));
        // Element completely below viewport
        assert!(!is_in_viewport(
            (100.0, 700.0, 50.0, 50.0),
            800.0,
            600.0,
            50.0
        ));
    }

    #[test]
    fn needs_scrolling_element_centered() {
        // Element near the center of viewport - no scroll needed
        let viewport_height = 600.0;
        let element_y = 270.0; // Near center (300 - 30)
        let element_height = 60.0;

        assert!(!needs_scrolling(
            (0.0, element_y, 100.0, element_height),
            viewport_height,
            10.0
        ));
    }

    #[test]
    fn needs_scrolling_element_at_top() {
        // Element at the top of viewport - scroll needed
        let viewport_height = 600.0;

        assert!(needs_scrolling(
            (0.0, 10.0, 100.0, 50.0),
            viewport_height,
            10.0
        ));
    }

    #[test]
    fn needs_scrolling_element_at_bottom() {
        // Element at the bottom of viewport - scroll needed
        let viewport_height = 600.0;

        assert!(needs_scrolling(
            (0.0, 540.0, 100.0, 50.0),
            viewport_height,
            10.0
        ));
    }

    #[test]
    fn needs_scrolling_element_outside_viewport() {
        // Element completely below viewport - scroll needed
        let viewport_height = 600.0;

        assert!(needs_scrolling(
            (0.0, 700.0, 100.0, 50.0),
            viewport_height,
            10.0
        ));
    }
}
