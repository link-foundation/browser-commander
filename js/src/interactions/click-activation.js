/**
 * Orthogonal click activation options.
 *
 * `noAutoScroll: true` used to be translated into Playwright's `{ force: true }`,
 * which skips actionability checks but still scrolls the element into view. The
 * option therefore promised something the engine never delivered. These three
 * axes are independent and each one means exactly what it says:
 *
 * - `activation`: how the click is delivered ('pointer' | 'dom')
 * - `scroll`: what may happen to the scroll position ('auto' | 'preserve' | 'none')
 * - `actionability`: whether engine pre-checks are skipped ('normal' | 'force')
 */

/** How the click is delivered to the element. */
export const CLICK_ACTIVATION = Object.freeze({
  /** Real pointer input at the element's click point. */
  POINTER: 'pointer',
  /** `HTMLElement.click()` - an untrusted event that skips pointer handlers. */
  DOM: 'dom',
});

/** What the click is allowed to do to the scroll position. */
export const CLICK_SCROLL = Object.freeze({
  /** Let the engine scroll the element into view (default). */
  AUTO: 'auto',
  /** Allow scrolling, then restore the original scroll position. */
  PRESERVE: 'preserve',
  /** Never scroll; fail if the click cannot be delivered without scrolling. */
  NONE: 'none',
});

/** Whether the engine's actionability pre-checks run. */
export const CLICK_ACTIONABILITY = Object.freeze({
  NORMAL: 'normal',
  /** Skip engine pre-checks. Does NOT disable scrolling. */
  FORCE: 'force',
});

/**
 * Thrown when `scroll: 'none'` cannot be honored.
 *
 * Failing loudly is the point: the previous behavior scrolled anyway and
 * reported success, so callers who needed the viewport to stay put had no way
 * to find out that it had moved.
 */
export class ScrollConstraintError extends Error {
  /**
   * @param {string} message - What made the constraint impossible to honor
   * @param {Object} [detail] - Structured detail about the element and viewport
   */
  constructor(message, detail = {}) {
    super(message);
    this.name = 'ScrollConstraintError';
    this.detail = detail;
  }
}

/**
 * Resolve the activation options, applying the `noAutoScroll` compatibility
 * mapping.
 *
 * @param {Object} options - Raw caller options
 * @param {string} [options.activation] - Activation mode
 * @param {string} [options.scroll] - Scroll policy
 * @param {string} [options.actionability] - Actionability policy
 * @param {boolean} [options.noAutoScroll] - Deprecated alias for `scroll: 'none'`
 * @param {Function} [options.log] - Logger used for the deprecation notice
 * @returns {{activation: string, scroll: string, actionability: string, deprecations: string[]}} Resolved options
 */
export function resolveActivationOptions(options = {}) {
  const { activation, scroll, actionability, noAutoScroll, log } = options;
  const deprecations = [];

  let resolvedScroll = scroll;

  if (noAutoScroll !== undefined) {
    deprecations.push(
      'noAutoScroll is deprecated; use scroll: "none" (no scrolling at all) ' +
        'or actionability: "force" (skip engine pre-checks, scrolling still allowed)'
    );
    if (resolvedScroll === undefined) {
      resolvedScroll = noAutoScroll ? CLICK_SCROLL.NONE : CLICK_SCROLL.AUTO;
    }
  }

  const resolved = {
    activation: activation ?? CLICK_ACTIVATION.POINTER,
    scroll: resolvedScroll ?? CLICK_SCROLL.AUTO,
    actionability: actionability ?? CLICK_ACTIONABILITY.NORMAL,
    deprecations,
  };

  assertOneOf('activation', resolved.activation, CLICK_ACTIVATION);
  assertOneOf('scroll', resolved.scroll, CLICK_SCROLL);
  assertOneOf('actionability', resolved.actionability, CLICK_ACTIONABILITY);

  if (deprecations.length > 0 && log?.debug) {
    deprecations.forEach((message) => log.debug(() => `⚠️  ${message}`));
  }

  return resolved;
}

/**
 * Start a click action: stamp the clock and resolve the activation options.
 *
 * Both `clickElement` and `clickButton` need an elapsed-time source and the
 * same option resolution, and both must do it *before* anything can throw so
 * that failures still report how long they took.
 *
 * @param {Object} options - Raw caller options, as accepted by {@link resolveActivationOptions}
 * @returns {{elapsed: Function, activationOptions: Object}} Elapsed-ms reader and resolved options
 */
export function beginClickAction(options = {}) {
  const startedAt = Date.now();

  return {
    elapsed: () => Date.now() - startedAt,
    activationOptions: resolveActivationOptions(options),
  };
}

function assertOneOf(name, value, allowed) {
  const values = Object.values(allowed);
  if (!values.includes(value)) {
    throw new Error(
      `${name} must be one of ${values.map((v) => `'${v}'`).join(', ')}, got '${value}'`
    );
  }
}

/**
 * Measure an element's click point and whether it is reachable right now.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.adapter - Engine adapter
 * @param {Object} options.locatorOrElement - Element or locator
 * @returns {Promise<Object>} Geometry and hit-test result
 */
export function measureClickPoint(options = {}) {
  const { adapter, locatorOrElement } = options;

  return adapter.evaluateOnElement(locatorOrElement, (el) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const inViewport =
      rect.width > 0 &&
      rect.height > 0 &&
      x >= 0 &&
      y >= 0 &&
      x <= window.innerWidth &&
      y <= window.innerHeight;
    const hit = inViewport ? document.elementFromPoint(x, y) : null;

    return {
      x,
      y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
      inViewport,
      hitsTarget: Boolean(hit && (hit === el || el.contains(hit))),
    };
  });
}

/**
 * Read the current window scroll position.
 *
 * @param {Object} adapter - Engine adapter
 * @returns {Promise<{x: number, y: number}>} Scroll offsets
 */
export async function readScrollPosition(adapter) {
  if (typeof adapter?.evaluateOnPage !== 'function') {
    return null;
  }
  try {
    return await adapter.evaluateOnPage(() => ({
      x: window.scrollX,
      y: window.scrollY,
    }));
  } catch {
    // Scroll position is evidence, not a precondition - never fail a click
    // because we could not read it.
    return null;
  }
}

/**
 * Restore a previously captured scroll position.
 *
 * @param {Object} adapter - Engine adapter
 * @param {{x: number, y: number}} position - Position to restore
 * @returns {Promise<void>} Resolves once restored
 */
export async function restoreScrollPosition(adapter, position) {
  if (!position || typeof adapter?.evaluateOnPage !== 'function') {
    return;
  }
  await adapter.evaluateOnPage(
    (pos) => window.scrollTo(pos.x, pos.y),
    position
  );
}

/**
 * Deliver a click according to the resolved activation options.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Object} options.adapter - Engine adapter
 * @param {Object} options.locatorOrElement - Element or locator to click
 * @param {Object} options.activationOptions - Result of {@link resolveActivationOptions}
 * @param {Function} [options.log] - Logger instance
 * @returns {Promise<{mode: string, scrollBefore: Object|null, scrollAfter: Object|null, point: Object|null}>} Dispatch detail
 * @throws {ScrollConstraintError} When `scroll: 'none'` cannot be honored
 */
export async function dispatchClick(options = {}) {
  const {
    page,
    adapter,
    locatorOrElement,
    activationOptions,
    log = { debug: () => {} },
  } = options;

  const { activation, scroll, actionability } = activationOptions;

  if (activation === CLICK_ACTIVATION.DOM) {
    log.debug(
      () =>
        '🖱️  Dispatching DOM activation (HTMLElement.click(); untrusted event, no scrolling)'
    );
    const scrollBefore = await readScrollPosition(adapter);
    await adapter.evaluateOnElement(locatorOrElement, (el) => el.click());
    return {
      mode: CLICK_ACTIVATION.DOM,
      scrollBefore,
      scrollAfter: await readScrollPosition(adapter),
      point: null,
    };
  }

  if (scroll === CLICK_SCROLL.NONE) {
    return dispatchPointerWithoutScrolling({
      page,
      adapter,
      locatorOrElement,
      log,
    });
  }

  const scrollBefore = await readScrollPosition(adapter);
  const engineOptions =
    actionability === CLICK_ACTIONABILITY.FORCE ? { force: true } : {};
  await adapter.click(locatorOrElement, engineOptions);

  if (scroll === CLICK_SCROLL.PRESERVE) {
    await restoreScrollPosition(adapter, scrollBefore);
  }

  return {
    mode: CLICK_ACTIVATION.POINTER,
    scrollBefore,
    scrollAfter: await readScrollPosition(adapter),
    point: null,
  };
}

async function dispatchPointerWithoutScrolling(options) {
  const { page, adapter, locatorOrElement, log } = options;

  const point = await measureClickPoint({ adapter, locatorOrElement });

  if (!point.inViewport) {
    throw new ScrollConstraintError(
      'scroll: "none" was requested but the element is outside the viewport, ' +
        'so a real pointer click cannot reach it without scrolling. Use ' +
        'scroll: "preserve" to scroll and restore, scroll: "auto" to allow ' +
        'scrolling, or activation: "dom" to dispatch an untrusted click.',
      point
    );
  }

  if (!point.hitsTarget) {
    throw new ScrollConstraintError(
      'scroll: "none" was requested but another element covers the target at ' +
        'its click point, so a real pointer click would hit the wrong element.',
      point
    );
  }

  log.debug(
    () =>
      `🖱️  Pointer click at (${Math.round(point.x)}, ${Math.round(point.y)}) without scrolling`
  );

  const scrollBefore = { x: point.scroll.x, y: point.scroll.y };
  await page.mouse.click(point.x, point.y);
  const scrollAfter = await readScrollPosition(adapter);

  return { mode: CLICK_ACTIVATION.POINTER, scrollBefore, scrollAfter, point };
}
