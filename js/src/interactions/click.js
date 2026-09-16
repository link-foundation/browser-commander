import { TIMING } from '../core/constants.js';
import { isNavigationError } from '../core/navigation-safety.js';
import { isActionStoppedError } from '../core/page-trigger-manager.js';
import { waitForLocatorOrElement } from '../elements/locators.js';
import { scrollIntoViewIfNeeded } from './scroll.js';
import { logElementInfo } from '../elements/content.js';
import { createEngineAdapter } from '../core/engine-adapter.js';
import { runWithinDeadline } from '../core/readiness.js';
import {
  CLICK_EFFECT,
  CLICK_STATUS,
  evidence,
  makeClickResult,
  nextActionId,
} from './click-result.js';
import {
  CLICK_SCROLL,
  ScrollConstraintError,
  beginClickAction,
  dispatchClick,
} from './click-activation.js';

/**
 * Whether an error means the page moved out from under the action rather than
 * the action itself failing.
 *
 * @param {Error} error - Error thrown while acting on the page
 * @returns {boolean} True when the action was interrupted, not broken
 */
function isInterrupted(error) {
  return isNavigationError(error) || isActionStoppedError(error);
}

/**
 * Read the target element's observable state under the click's own budget.
 *
 * The engine's locator timeout is far longer than a click's - Playwright waits
 * 30 seconds for an element a navigation already took away - so the budget the
 * caller asked for has to bound the probe.
 *
 * @param {Object} options - Probe options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type
 * @param {Object} options.locatorOrElement - Element to read
 * @param {Object} [options.adapter] - Engine adapter
 * @param {Object} [options.deadline] - Deadline the whole click shares
 * @returns {Promise<{timedOut: boolean, value: Object}>} Element state, or expiry
 */
function probeElementState(options) {
  const { page, engine, locatorOrElement, adapter, deadline } = options;
  const resolved = adapter || createEngineAdapter(page, engine);

  return runWithinDeadline(deadline, () =>
    resolved.evaluateOnElement(locatorOrElement, ELEMENT_STATE_PROBE)
  );
}

/**
 * A verdict for verification that ran out of budget before it saw anything.
 *
 * Nothing was observed, so nothing is claimed - only that time, rather than
 * the click, is what ended the attempt.
 *
 * @param {Object} [deadline] - Deadline the click shared
 * @param {string} what - What the budget expired before, e.g. 'the element could be read'
 * @returns {Object} Verification verdict
 */
function timedOutVerdict(deadline, what) {
  return {
    verified: false,
    timedOut: true,
    effect: CLICK_EFFECT.NOT_OBSERVED,
    reason: `verification budget expired before ${what}`,
    evidence: [
      evidence('verification-timeout', {
        timeoutMs: deadline?.timeoutMs,
        elapsedMs: deadline?.elapsedMs(),
      }),
    ],
  };
}

const ELEMENT_STATE_PROBE = (el) => ({
  disabled: el.disabled,
  ariaPressed: el.getAttribute('aria-pressed'),
  ariaExpanded: el.getAttribute('aria-expanded'),
  ariaSelected: el.getAttribute('aria-selected'),
  checked: el.checked,
  className: el.className,
  isConnected: el.isConnected,
});

const OBSERVED_STATE_KEYS = [
  ['ariaPressed', 'aria-pressed changed'],
  ['ariaExpanded', 'aria-expanded changed'],
  ['ariaSelected', 'aria-selected changed'],
  ['checked', 'checked state changed'],
  ['className', 'className changed'],
  ['disabled', 'disabled state changed'],
];

/**
 * Default verification for click operations.
 *
 * This reports what it observed and nothing more. In particular, an element
 * that is still present and unchanged is *not* evidence that the click did
 * anything - that is precisely the case of a button whose handler is missing
 * or threw - so it is reported as `not-observed` rather than as success.
 *
 * @param {Object} options - Verification options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Object} options.locatorOrElement - Element that was clicked
 * @param {Object} [options.preClickState] - State captured before the click
 * @param {Object} [options.adapter] - Engine adapter
 * @param {Object} [options.deadline] - Deadline the whole click shares
 * @returns {Promise<{verified: boolean, effect: string, reason: string, evidence: Array, navigationError: (boolean|undefined), timedOut: (boolean|undefined)}>} Verification outcome
 */
export async function defaultClickVerification(options = {}) {
  const { preClickState = {}, deadline } = options;

  try {
    const probe = await probeElementState(options);

    if (probe.timedOut) {
      return timedOutVerdict(deadline, 'the element could be read');
    }

    const postClickState = probe.value;

    const hasPreState = preClickState && Object.keys(preClickState).length > 0;

    if (hasPreState) {
      for (const [key, reason] of OBSERVED_STATE_KEYS) {
        if (preClickState[key] !== postClickState[key]) {
          return {
            verified: true,
            effect: CLICK_EFFECT.CONFIRMED,
            reason,
            evidence: [
              evidence('element-state', {
                key,
                before: preClickState[key],
                after: postClickState[key],
              }),
            ],
          };
        }
      }
    }

    if (!postClickState.isConnected) {
      // Detachment is a real, observable change in the document.
      return {
        verified: true,
        effect: CLICK_EFFECT.CONFIRMED,
        reason: 'element removed from DOM (UI updated)',
        evidence: [
          evidence('element-state', { key: 'isConnected', after: false }),
        ],
      };
    }

    return {
      verified: false,
      effect: CLICK_EFFECT.NOT_OBSERVED,
      reason: hasPreState
        ? 'no observable change to the target element after the click'
        : 'no pre-click state captured, so no change could be observed',
      evidence: [evidence('element-state', { unchanged: true, hasPreState })],
    };
  } catch (error) {
    if (isInterrupted(error)) {
      // The execution context went away. That is consistent with the click
      // having navigated the page, but it is equally consistent with an
      // unrelated navigation already in flight. Verification is simply
      // unavailable; correlation is the caller's job.
      return {
        verified: false,
        effect: CLICK_EFFECT.NOT_OBSERVED,
        reason:
          'verification unavailable: execution context was destroyed during verification',
        navigationError: true,
        evidence: [
          evidence('verification-unavailable', { message: error.message }),
        ],
      };
    }
    throw error;
  }
}

/**
 * Capture element state before click for verification
 * @param {Object} options - Options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type
 * @param {Object} options.locatorOrElement - Element to capture state from
 * @param {Object} options.adapter - Engine adapter (optional, will be created if not provided)
 * @param {Object} [options.deadline] - Deadline the whole click shares
 * @returns {Promise<Object>} - Pre-click state object, empty when it could not be read in time
 */
export async function capturePreClickState(options = {}) {
  try {
    const probe = await probeElementState(options);
    // A state that could not be read in time is no state at all; the click
    // then has nothing to compare against and says so rather than guessing.
    return probe.timedOut ? {} : probe.value;
  } catch (error) {
    if (isInterrupted(error)) {
      return {};
    }
    throw error;
  }
}

/**
 * Verify click operation
 * @param {Object} options - Verification options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type
 * @param {Object} options.locatorOrElement - Element that was clicked
 * @param {Object} options.preClickState - State captured before click
 * @param {Function} options.verifyFn - Custom verification function (optional)
 * @param {Object} options.adapter - Engine adapter (optional)
 * @param {Object} [options.deadline] - Deadline the whole click shares
 * @param {Function} options.log - Logger instance
 * @returns {Promise<Object>} Verification outcome with `effect` and `evidence`
 */
export async function verifyClick(options = {}) {
  const {
    page,
    engine,
    locatorOrElement,
    preClickState = {},
    verifyFn = defaultClickVerification,
    adapter,
    deadline,
    log = { debug: () => {} },
  } = options;

  // Custom verifiers are free to ignore the deadline, so bound them too -
  // otherwise one verifier that never returns outlasts the whole budget.
  const outcome = await runWithinDeadline(deadline, () =>
    verifyFn({
      page,
      engine,
      locatorOrElement,
      preClickState,
      adapter,
      deadline,
    })
  );

  if (outcome.timedOut) {
    log.debug(() => '⚠️  Click verification ran out of time');
    return timedOutVerdict(deadline, 'an effect could be observed');
  }

  const result = outcome.value;

  // Custom verifiers predate the effect vocabulary, so map their boolean.
  const normalized = {
    ...result,
    effect:
      result.effect ??
      (result.verified ? CLICK_EFFECT.CONFIRMED : CLICK_EFFECT.NOT_OBSERVED),
    evidence: result.evidence ?? [],
  };

  if (normalized.effect === CLICK_EFFECT.CONFIRMED) {
    log.debug(() => `✅ Click effect confirmed: ${normalized.reason}`);
  } else {
    log.debug(
      () =>
        `⚠️  Click effect ${normalized.effect}: ${normalized.reason || 'unknown'}`
    );
  }

  return normalized;
}

/**
 * Click an element (low-level).
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object (required for verification)
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Function} options.log - Logger instance
 * @param {Object} options.locatorOrElement - Element or locator to click
 * @param {string} [options.activation='pointer'] - 'pointer' (real input) or 'dom' (untrusted `el.click()`)
 * @param {string} [options.scroll='auto'] - 'auto', 'preserve' (restore position) or 'none' (never scroll)
 * @param {string} [options.actionability='normal'] - 'normal' or 'force' (skip engine pre-checks)
 * @param {boolean} [options.noAutoScroll] - Deprecated alias for `scroll: 'none'`
 * @param {boolean} [options.verify=true] - Whether to verify the click effect
 * @param {Function} [options.verifyFn] - Custom verification function
 * @param {Object} [options.adapter] - Engine adapter
 * @param {string} [options.actionId] - Correlation ID for this click
 * @param {number} [options.timeout] - Budget for the whole click, verification included
 * @returns {Promise<Object>} Click result from {@link makeClickResult}
 */
export async function clickElement(options = {}) {
  const {
    page,
    engine,
    log = { debug: () => {} },
    locatorOrElement,
    activation,
    scroll,
    actionability,
    noAutoScroll,
    verify = true,
    verifyFn,
    adapter: providedAdapter,
    actionId = nextActionId(),
    timeout,
  } = options;

  if (!locatorOrElement) {
    throw new Error('locatorOrElement is required in options');
  }

  const { deadline, elapsed, activationOptions } = beginClickAction({
    activation,
    scroll,
    actionability,
    noAutoScroll,
    timeout,
    log,
  });

  try {
    const adapter = providedAdapter || createEngineAdapter(page, engine);
    const urlBeforeDispatch = readPageUrl(page);

    let preClickState = {};
    if (verify && page) {
      preClickState = await capturePreClickState({
        page,
        engine,
        locatorOrElement,
        adapter,
        deadline,
      });
    }

    /**
     * Describe a click the page never received.
     *
     * @param {string} status - Status to report
     * @param {string} reason - Why the click did not happen
     * @param {Object} record - Evidence for that reason
     * @returns {Object} Click result
     */
    const neverDispatched = (status, reason, record) =>
      makeClickResult({
        status,
        dispatched: false,
        effect: CLICK_EFFECT.NOT_OBSERVED,
        reason,
        evidence: [record],
        elapsedMs: elapsed(),
        actionId,
      });

    let dispatch;
    try {
      // Dispatch is bounded too: locating a click point and reading the scroll
      // position are engine round-trips, and an unbounded one spends the budget
      // the caller reserved for the whole click.
      const dispatching = await runWithinDeadline(deadline, () =>
        dispatchClick({
          page,
          adapter,
          locatorOrElement,
          activationOptions,
          log,
        })
      );

      if (dispatching.timedOut) {
        return neverDispatched(
          CLICK_STATUS.TIMED_OUT,
          'click budget expired before the click could be dispatched',
          evidence('dispatch-timeout', {
            timeoutMs: deadline?.timeoutMs,
            elapsedMs: deadline?.elapsedMs(),
          })
        );
      }

      dispatch = dispatching.value;
    } catch (error) {
      if (error instanceof ScrollConstraintError) {
        // The caller asked for no scrolling and we cannot deliver the click
        // without it. Say so instead of scrolling behind their back.
        return neverDispatched(
          CLICK_STATUS.FAILED,
          error.message,
          evidence('scroll-constraint', error.detail)
        );
      }
      throw error;
    }

    const dispatchEvidence = [
      evidence('dispatch', {
        mode: dispatch.mode,
        activation: activationOptions.activation,
        scroll: activationOptions.scroll,
        actionability: activationOptions.actionability,
        scrollBefore: dispatch.scrollBefore,
        scrollAfter: dispatch.scrollAfter,
        scrollChanged: scrollChanged(dispatch),
        point: dispatch.point,
      }),
    ];

    if (
      activationOptions.scroll !== CLICK_SCROLL.AUTO &&
      scrollChanged(dispatch)
    ) {
      // We did not scroll, but the page reacted by scrolling itself. Record it
      // so callers asserting on viewport stability can see what moved.
      dispatchEvidence.push(
        evidence('page-scrolled-itself', {
          before: dispatch.scrollBefore,
          after: dispatch.scrollAfter,
        })
      );
    }

    if (!verify || !page) {
      return makeClickResult({
        status: CLICK_STATUS.UNVERIFIED,
        dispatched: true,
        effect: CLICK_EFFECT.NOT_OBSERVED,
        reason: 'click dispatched; verification not requested',
        evidence: dispatchEvidence,
        elapsedMs: elapsed(),
        actionId,
      });
    }

    // A navigation replaces the document the element lived in, and engines
    // answer an element probe on the *new* document instead of failing - which
    // is how a navigating click used to spend the whole budget waiting for an
    // element that no longer exists. Watching the URL ends the wait at once.
    const watch = watchForNavigation(page, urlBeforeDispatch);
    const verifying = verifyClick({
      page,
      engine,
      locatorOrElement,
      preClickState,
      verifyFn,
      adapter,
      deadline,
      log,
    });
    // Verification that loses the race still settles on its own schedule, so
    // its failure is absorbed here rather than surfacing later as an unhandled
    // rejection in a process that has long since moved on.
    verifying.catch(() => {});

    let verification;
    try {
      verification = await Promise.race([verifying, watch.navigated]);
    } finally {
      watch.stop();
    }

    const confirmed = verification.effect === CLICK_EFFECT.CONFIRMED;
    const navigatedAway =
      verification.navigatedTo ?? pageNavigatedSince(page, urlBeforeDispatch);

    if (navigatedAway && !confirmed) {
      // The document the element belonged to is gone, so there is nothing left
      // to observe. The navigation is recorded as what it is - a correlated
      // event - and *not* as proof that this click caused it.
      return makeClickResult({
        status: CLICK_STATUS.UNVERIFIED,
        dispatched: true,
        effect: CLICK_EFFECT.NOT_OBSERVED,
        reason:
          'the page navigated after the click, so the click effect could not be observed on the original document',
        evidence: [
          ...dispatchEvidence,
          ...verification.evidence,
          evidence('navigation', {
            actionId,
            from: urlBeforeDispatch,
            to: navigatedAway,
            correlated: true,
            provesClickEffect: false,
          }),
        ],
        elapsedMs: elapsed(),
        actionId,
        navigationError: true,
      });
    }

    return makeClickResult({
      // The click was delivered either way; only the observation ran out of
      // time, and `timed_out` says exactly that rather than blaming the click.
      status: verificationStatus(confirmed, verification.timedOut),
      dispatched: true,
      effect: verification.effect,
      reason: verification.reason,
      evidence: [...dispatchEvidence, ...verification.evidence],
      elapsedMs: elapsed(),
      actionId,
      ...(verification.navigationError ? { navigationError: true } : {}),
    });
  } catch (error) {
    if (isInterrupted(error)) {
      log.debug(
        () => '⚠️  Navigation/stop interrupted the click, recovering gracefully'
      );
      return makeClickResult({
        status: CLICK_STATUS.INTERRUPTED,
        dispatched: false,
        effect: CLICK_EFFECT.NOT_OBSERVED,
        reason:
          'navigation or stop interrupted the click before it could be observed',
        evidence: [evidence('interrupted', { message: error.message })],
        elapsedMs: elapsed(),
        actionId,
      });
    }
    throw error;
  }
}

/** How often the navigation watch samples the page URL, in milliseconds. */
const NAVIGATION_POLL_INTERVAL = 50;

/**
 * Watch for the page leaving the document a click was dispatched into.
 *
 * The returned promise settles only on navigation, so it can lose a race
 * against verification without ever forcing a wait of its own.
 *
 * @param {Object} page - Browser page object
 * @param {string|null} urlBefore - URL read immediately before dispatch
 * @returns {{navigated: Promise<Object>, stop: Function}} Watch handle
 */
function watchForNavigation(page, urlBefore) {
  let timer;
  const stop = () => clearInterval(timer);

  const navigated = new Promise((resolve) => {
    if (!urlBefore) {
      return;
    }
    timer = setInterval(() => {
      const to = pageNavigatedSince(page, urlBefore);
      if (to) {
        stop();
        resolve({
          effect: CLICK_EFFECT.NOT_OBSERVED,
          evidence: [],
          navigatedTo: to,
        });
      }
    }, NAVIGATION_POLL_INTERVAL);
    // The watch must never keep the process alive on its own.
    timer.unref?.();
  });

  return { navigated, stop };
}

/**
 * Read the page's current URL, tolerating pages that cannot answer.
 *
 * @param {Object} page - Browser page object, possibly a mock without `url`
 * @returns {string|null} Current URL, or null when it is unavailable
 */
function readPageUrl(page) {
  if (typeof page?.url !== 'function') {
    return null;
  }
  try {
    return page.url();
  } catch {
    // A closed or crashed page cannot report a URL; that is not a click error.
    return null;
  }
}

/**
 * Whether the page left the document the click was dispatched into.
 *
 * @param {Object} page - Browser page object
 * @param {string|null} urlBefore - URL read immediately before dispatch
 * @returns {string|null} The new URL when it changed, otherwise null
 */
function pageNavigatedSince(page, urlBefore) {
  if (!urlBefore) {
    return null;
  }
  const now = readPageUrl(page);
  return now && now !== urlBefore ? now : null;
}

/**
 * Status for a dispatched click, given what verification managed to observe.
 *
 * @param {boolean} confirmed - Whether an effect was actually observed
 * @param {boolean} [timedOut] - Whether verification ran out of budget
 * @returns {string} One of {@link CLICK_STATUS}
 */
function verificationStatus(confirmed, timedOut) {
  if (confirmed) {
    return CLICK_STATUS.SUCCEEDED;
  }
  return timedOut ? CLICK_STATUS.TIMED_OUT : CLICK_STATUS.UNVERIFIED;
}

function scrollChanged(dispatch) {
  const { scrollBefore, scrollAfter } = dispatch;
  if (!scrollBefore || !scrollAfter) {
    return null;
  }
  return scrollBefore.x !== scrollAfter.x || scrollBefore.y !== scrollAfter.y;
}

/**
 * Detect whether navigation can be attributed to a specific click.
 *
 * A navigation that was already in flight before the click is not evidence
 * about the click, so the navigation session recorded before dispatch is
 * compared against the current one instead of merely asking "are we navigating".
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Object} [options.navigationManager] - NavigationManager instance
 * @param {string} options.startUrl - URL before the click
 * @param {number} [options.startSessionId] - Navigation session ID before the click
 * @param {string} [options.actionId] - Correlation ID for the click
 * @param {Function} options.log - Logger instance
 * @returns {{navigated: boolean, correlated: boolean, newUrl: string, evidence: Array}} Detection outcome
 */
function detectNavigation(options = {}) {
  const { page, navigationManager, startUrl, startSessionId, actionId, log } =
    options;

  const newUrl = page.url();
  const urlChanged = newUrl !== startUrl;
  const sessionId = navigationManager?.getSessionId?.();
  const sessionAdvanced =
    startSessionId !== undefined &&
    sessionId !== undefined &&
    sessionId > startSessionId;
  const navigating = Boolean(navigationManager?.isNavigating?.());

  const correlated = urlChanged || sessionAdvanced;
  const navigated = correlated || navigating;

  if (navigated) {
    log.debug(
      () =>
        `🔄 Navigation ${correlated ? 'correlated with' : 'in flight but NOT correlated with'} ` +
        `click ${actionId}: ${startUrl} → ${newUrl}`
    );
  }

  return {
    navigated,
    correlated,
    newUrl,
    evidence: [
      evidence('navigation', {
        actionId,
        startUrl,
        newUrl,
        urlChanged,
        startSessionId,
        sessionId,
        sessionAdvanced,
        navigating,
        correlated,
      }),
    ],
  };
}

/**
 * Prepare element for clicking - find, validate, and optionally scroll into view
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type
 * @param {Function} options.wait - Wait function
 * @param {Function} options.log - Logger instance
 * @param {boolean} options.verbose - Enable verbose logging
 * @param {string|Object} options.selector - CSS selector, ElementHandle, or Playwright Locator
 * @param {boolean} options.scrollIntoView - Scroll into view (default: true)
 * @param {number} options.waitAfterScroll - Wait time after scroll in ms
 * @param {boolean} options.smoothScroll - Use smooth scroll animation
 * @param {number} options.timeout - Timeout in ms
 * @returns {Promise<{locatorOrElement: Object, scrolled: boolean, navigated: boolean}>} Preparation outcome
 */
async function prepareElement(options = {}) {
  const {
    page,
    engine,
    wait,
    log,
    verbose = false,
    selector,
    scrollIntoView: shouldScroll = true,
    waitAfterScroll,
    smoothScroll = true,
    timeout,
  } = options;

  const locatorOrElement = await waitForLocatorOrElement({
    page,
    engine,
    selector,
    timeout,
  });

  if (verbose) {
    await logElementInfo({ page, engine, log, locatorOrElement });
  }

  if (!shouldScroll) {
    log.debug(() => '🔍 [VERBOSE] Skipping scroll (scroll policy forbids it)');
    return { locatorOrElement, scrolled: false, navigated: false };
  }

  const behavior = smoothScroll ? 'smooth' : 'instant';
  const scrollResult = await scrollIntoViewIfNeeded({
    page,
    engine,
    wait,
    log,
    locatorOrElement,
    behavior,
    waitAfterScroll,
    verify: false, // The overall click result carries the verification.
  });

  if (!scrollResult.skipped && !scrollResult.scrolled) {
    return { locatorOrElement: null, scrolled: false, navigated: true };
  }
  return { locatorOrElement, scrolled: true, navigated: false };
}

/**
 * Wait for the page to settle after a click and report navigation evidence.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {Function} options.wait - Wait function
 * @param {Function} options.log - Logger instance
 * @param {Object} [options.navigationManager] - NavigationManager instance
 * @param {Object} [options.networkTracker] - NetworkTracker instance
 * @param {string} options.startUrl - URL before the click
 * @param {number} [options.startSessionId] - Navigation session ID before the click
 * @param {string} [options.actionId] - Correlation ID for the click
 * @param {boolean} [options.waitForNavigation=true] - Whether to look for navigation
 * @param {number} [options.navigationCheckDelay=500] - Grace period for navigation to start
 * @param {number} [options.waitAfterClick=1000] - Settling time when nothing navigated
 * @param {number} [options.navigationReadyTimeout] - Budget for the post-navigation readiness wait
 * @returns {Promise<{navigated: boolean, correlated: boolean, ready: boolean|null, reason: string, evidence: Array}>} Navigation outcome
 */
async function handleNavigationAfterClick(options = {}) {
  const {
    page,
    wait,
    log,
    navigationManager,
    networkTracker,
    startUrl,
    startSessionId,
    actionId,
    waitForNavigation = true,
    navigationCheckDelay = 500,
    waitAfterClick = 1000,
    navigationReadyTimeout = TIMING.NAVIGATION_TIMEOUT,
  } = options;

  const detect = () =>
    detectNavigation({
      page,
      navigationManager,
      startUrl,
      startSessionId,
      actionId,
      log,
    });

  const settle = async (reason) => {
    if (navigationManager) {
      return navigationManager.waitForPageReady({
        timeout: navigationReadyTimeout,
        reason,
      });
    }
    if (networkTracker) {
      return networkTracker.waitForNetworkIdle({
        timeout: navigationReadyTimeout,
      });
    }
    await wait({ ms: 2000, reason: 'page settle after navigation' });
    return null;
  };

  if (waitForNavigation) {
    await wait({
      ms: navigationCheckDelay,
      reason: 'checking for navigation after click',
    });

    const detection = detect();
    if (detection.navigated) {
      const ready = await settle('after click navigation');
      return {
        navigated: true,
        correlated: detection.correlated,
        ready,
        reason: detection.correlated
          ? 'click triggered navigation'
          : 'navigation observed but not attributable to this click',
        evidence: [...detection.evidence, evidence('readiness', { ready })],
      };
    }
  }

  if (waitAfterClick > 0) {
    const waitResult = await wait({
      ms: waitAfterClick,
      reason: 'post-click settling time for modal scroll capture',
    });

    if (waitResult && waitResult.aborted) {
      log.debug(
        () => '🔄 Navigation detected during post-click wait (wait was aborted)'
      );
      const lateDetection = detect();
      if (lateDetection.navigated) {
        const ready = await settle('after late-detected click navigation');
        return {
          navigated: true,
          correlated: lateDetection.correlated,
          ready,
          reason: lateDetection.correlated
            ? 'late-detected navigation'
            : 'late navigation observed but not attributable to this click',
          evidence: [
            ...lateDetection.evidence,
            evidence('readiness', { ready }),
          ],
        };
      }
    }
  }

  if (navigationManager && navigationManager.shouldAbort()) {
    const abortDetection = detect();
    const ready = await settle('after abort-detected click navigation');
    return {
      navigated: true,
      correlated: abortDetection.correlated,
      ready,
      reason: abortDetection.correlated
        ? 'abort-signal navigation'
        : 'abort signal raised by a navigation not attributable to this click',
      evidence: [...abortDetection.evidence, evidence('readiness', { ready })],
    };
  }

  if (networkTracker) {
    await networkTracker.waitForNetworkIdle({ timeout: 10000, idleTime: 2000 });
  }

  return {
    navigated: false,
    correlated: false,
    ready: null,
    reason: 'no navigation detected',
    evidence: detect().evidence,
  };
}

function combineEffects(clickResult, navResult) {
  if (navResult.correlated) {
    return CLICK_EFFECT.CONFIRMED;
  }
  return clickResult.effect;
}

function combineStatus(clickResult, navResult) {
  if (navResult.correlated) {
    // Navigation attributable to this click also answers "did it do anything".
    return navResult.ready === false
      ? CLICK_STATUS.TIMED_OUT
      : CLICK_STATUS.SUCCEEDED;
  }
  return clickResult.status;
}

/**
 * Click a button or element (high-level with scrolling, waits and navigation
 * correlation).
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Browser page object
 * @param {string} options.engine - Engine type ('playwright' or 'puppeteer')
 * @param {Function} options.wait - Wait function
 * @param {Function} options.log - Logger instance
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {Object} [options.navigationManager] - NavigationManager instance
 * @param {Object} [options.networkTracker] - NetworkTracker instance
 * @param {string|Object} options.selector - CSS selector, ElementHandle, or Playwright Locator
 * @param {string} [options.activation='pointer'] - 'pointer' or 'dom'
 * @param {string} [options.scroll] - 'auto', 'preserve' or 'none'
 * @param {string} [options.actionability='normal'] - 'normal' or 'force'
 * @param {boolean} [options.scrollIntoView=true] - Deprecated alias; `false` means `scroll: 'none'`
 * @param {number} [options.waitAfterScroll] - Wait time after scroll in ms
 * @param {boolean} [options.smoothScroll=true] - Use smooth scroll animation
 * @param {number} [options.waitAfterClick=1000] - Wait time after click in ms
 * @param {boolean} [options.waitForNavigation=true] - Wait for navigation to complete
 * @param {number} [options.navigationCheckDelay=500] - Time to check if navigation started
 * @param {number} [options.timeout] - Element lookup timeout in ms
 * @param {boolean} [options.verify=true] - Whether to verify the click effect
 * @param {Function} [options.verifyFn] - Custom verification function
 * @returns {Promise<Object>} Click result from {@link makeClickResult}
 * @throws {Error} If selector is missing or the click fails for a non-navigation reason
 */
export async function clickButton(options = {}) {
  const {
    page,
    engine,
    wait,
    log = { debug: () => {} },
    verbose = false,
    navigationManager,
    networkTracker,
    selector,
    activation,
    scroll,
    actionability,
    scrollIntoView,
    waitAfterScroll = TIMING.DEFAULT_WAIT_AFTER_SCROLL,
    smoothScroll = true,
    waitAfterClick = 1000,
    waitForNavigation = true,
    navigationCheckDelay = 500,
    timeout = TIMING.DEFAULT_TIMEOUT,
    verify = true,
    verifyFn,
  } = options;

  if (!selector) {
    throw new Error('clickButton: selector is required in options');
  }

  const actionId = nextActionId();
  // The same budget covers locating, scrolling, clicking and verifying, so a
  // button click cannot quietly cost several times the timeout asked for.
  const { deadline, elapsed, activationOptions } = beginClickAction({
    activation,
    scroll,
    actionability,
    noAutoScroll: scrollIntoView === undefined ? undefined : !scrollIntoView,
    timeout,
    log,
  });

  const startUrl = page.url();
  const startSessionId = navigationManager?.getSessionId?.();

  try {
    const prepareResult = await prepareElement({
      page,
      engine,
      wait,
      log,
      verbose,
      selector,
      scrollIntoView: activationOptions.scroll === CLICK_SCROLL.AUTO,
      waitAfterScroll,
      smoothScroll,
      timeout,
    });

    if (prepareResult.navigated) {
      const detection = detectNavigation({
        page,
        navigationManager,
        startUrl,
        startSessionId,
        actionId,
        log,
      });
      return makeClickResult({
        status: CLICK_STATUS.INTERRUPTED,
        dispatched: false,
        effect: CLICK_EFFECT.NOT_OBSERVED,
        navigated: detection.navigated,
        reason: 'navigation interrupted the scroll before the click',
        evidence: detection.evidence,
        elapsedMs: elapsed(),
        actionId,
      });
    }

    const clickResult = await clickElement({
      page,
      engine,
      log,
      locatorOrElement: prepareResult.locatorOrElement,
      activation: activationOptions.activation,
      scroll: activationOptions.scroll,
      actionability: activationOptions.actionability,
      verify,
      verifyFn,
      actionId,
      timeout: deadline.remainingMs(),
    });

    if (clickResult.status === CLICK_STATUS.FAILED) {
      return { ...clickResult, elapsedMs: elapsed() };
    }

    const navResult = await handleNavigationAfterClick({
      page,
      wait,
      log,
      navigationManager,
      networkTracker,
      startUrl,
      startSessionId,
      actionId,
      waitForNavigation,
      navigationCheckDelay,
      waitAfterClick,
    });

    return makeClickResult({
      status: combineStatus(clickResult, navResult),
      dispatched: clickResult.dispatched,
      effect: combineEffects(clickResult, navResult),
      navigated: navResult.navigated,
      reason: navResult.navigated ? navResult.reason : clickResult.reason,
      evidence: [...clickResult.evidence, ...navResult.evidence],
      elapsedMs: elapsed(),
      actionId,
    });
  } catch (error) {
    if (isInterrupted(error)) {
      log.debug(
        () =>
          '⚠️  Navigation/stop detected during clickButton, recovering gracefully'
      );
      const detection = detectNavigation({
        page,
        navigationManager,
        startUrl,
        startSessionId,
        actionId,
        log,
      });
      return makeClickResult({
        status: detection.correlated
          ? CLICK_STATUS.SUCCEEDED
          : CLICK_STATUS.INTERRUPTED,
        dispatched: detection.correlated,
        effect: detection.correlated
          ? CLICK_EFFECT.CONFIRMED
          : CLICK_EFFECT.NOT_OBSERVED,
        navigated: detection.navigated,
        reason: detection.correlated
          ? 'click triggered navigation (observed while recovering from a navigation error)'
          : 'navigation or stop error interrupted the click; effect not attributable',
        evidence: [
          ...detection.evidence,
          evidence('interrupted', { message: error.message }),
        ],
        elapsedMs: elapsed(),
        actionId,
      });
    }
    throw error;
  }
}

export { CLICK_EFFECT, CLICK_STATUS } from './click-result.js';
export {
  CLICK_ACTIONABILITY,
  CLICK_ACTIVATION,
  CLICK_SCROLL,
  ScrollConstraintError,
} from './click-activation.js';
