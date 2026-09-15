/**
 * Shared fixtures for the click tests.
 *
 * The activation tests and the `clickElement` tests exercise the same two
 * shapes - an element state probe result and a click-point probe result - so
 * they live here instead of drifting apart in two files.
 */

/** State of a plain, enabled button that nothing has changed. */
export const UNCHANGED_STATE = Object.freeze({
  disabled: false,
  ariaPressed: 'false',
  ariaExpanded: null,
  ariaSelected: null,
  checked: false,
  className: 'btn',
  isConnected: true,
});

/** Click-point probe result for an element fully inside the viewport. */
export const IN_VIEWPORT_POINT = Object.freeze({
  x: 50,
  y: 60,
  width: 100,
  height: 40,
  top: 40,
  left: 0,
  viewport: { width: 800, height: 600 },
  scroll: { x: 0, y: 0 },
  inViewport: true,
  hitsTarget: true,
});

/**
 * A mutable window scroll position with the `evaluateOnPage` contract the
 * click code uses: no argument reads the position, an argument writes it.
 *
 * @param {number} [initial] - Initial vertical scroll offset
 * @returns {{current: Function, set: Function, evaluateOnPage: Function}} Scroll model
 */
export function createScrollModel(initial = 0) {
  let scrollY = initial;

  return {
    current: () => scrollY,
    set: (next) => {
      scrollY = next;
    },
    evaluateOnPage: async (fn, arg) => {
      if (arg) {
        scrollY = arg.y;
        return undefined;
      }
      return { x: 0, y: scrollY };
    },
  };
}
