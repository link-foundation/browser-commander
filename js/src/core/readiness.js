/**
 * Readiness primitives - one monotonic deadline, composable checks, evidence.
 *
 * `waitForPageReady` used to answer "is the page ready?" with a hard-coded
 * sequence of waits, a floor that could outlive the caller's timeout, and a
 * constant `true`. This module supplies the pieces that make the answer
 * truthful: a deadline that only ever hands out non-negative remaining budget,
 * checks that report what they observed, and a result that distinguishes
 * "ready" from "we ran out of time".
 */

/** Statuses a readiness wait can end in. */
export const READINESS_STATUS = Object.freeze({
  READY: 'ready',
  TIMED_OUT: 'timed_out',
  FAILED: 'failed',
});

/**
 * Request classes that never go idle on their own. Waiting for them is waiting
 * for the timeout, so network idle ignores them unless a caller opts back in.
 */
export const LONG_LIVED_REQUEST_PATTERNS = Object.freeze([
  /^wss?:\/\//iu,
  /\/(?:socket\.io|sockjs|websocket|ws)(?:[/?]|$)/iu,
  /\/(?:event-?stream|sse|stream)(?:[/?]|$)/iu,
  /(?:^|\.)(?:google-analytics|googletagmanager|doubleclick|segment|mixpanel|amplitude|hotjar|sentry|datadoghq|newrelic)\./iu,
  /\/(?:analytics|telemetry|beacon|collect|metrics|heartbeat|ping|poll|longpoll)(?:[/?]|$)/iu,
]);

/**
 * True when a URL belongs to a request class that is expected to stay open.
 *
 * @param {string} url - Request URL
 * @param {RegExp[]} [patterns] - Patterns to test, defaults to the built-in list
 * @returns {boolean} Whether the request should be ignored by idle checks
 */
export function isLongLivedRequest(
  url,
  patterns = LONG_LIVED_REQUEST_PATTERNS
) {
  if (typeof url !== 'string' || url.length === 0) {
    return false;
  }
  return patterns.some((pattern) => pattern.test(url));
}

/**
 * Create a monotonic deadline shared by every check in one readiness wait.
 *
 * The clock is monotonic on purpose: a wall-clock jump (NTP correction, a
 * suspended laptop) must not turn a five second budget into a five minute one.
 *
 * @param {Object} options - Configuration options
 * @param {number} options.timeout - Total budget in milliseconds
 * @param {Function} [options.now] - Monotonic clock, defaults to performance.now
 * @returns {{startedAt: number, timeoutMs: number, elapsedMs: Function, remainingMs: Function, expired: Function}} Deadline handle
 */
export function createDeadline(options = {}) {
  const { timeout, now = () => performance.now() } = options;

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError('createDeadline requires a non-negative timeout');
  }

  const startedAt = now();
  const elapsed = () => Math.max(0, now() - startedAt);
  // `expired` is derived from `remainingMs` rather than measured separately:
  // rounding otherwise lets a caller read a remaining budget of zero while the
  // deadline still calls itself live, and a check that stopped because its
  // budget was gone would then be reported as failed instead of timed out.
  const remainingMs = () => Math.max(0, Math.round(timeout - elapsed()));

  return {
    startedAt,
    timeoutMs: timeout,
    elapsedMs: () => Math.round(elapsed()),
    remainingMs,
    expired: () => remainingMs() === 0,
  };
}

/**
 * Sleep for at most the deadline's remaining budget.
 *
 * @param {number} ms - Requested delay
 * @param {Object} deadline - Deadline from {@link createDeadline}
 * @returns {Promise<void>} Resolves after the capped delay
 */
export async function sleepWithinDeadline(ms, deadline) {
  const capped = Math.min(ms, deadline.remainingMs());
  if (capped <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, capped));
}

/** Marker resolved by the expiry timer in {@link runWithinDeadline}. */
const DEADLINE_REACHED = Symbol('deadline-reached');

/**
 * Run an operation under a deadline, reporting expiry instead of waiting.
 *
 * Engine probes carry timeouts of their own - Playwright's locator default is
 * 30 seconds - so an operation given a 3 second budget could spend ten times
 * that waiting for an element a navigation had already taken away. The budget
 * the caller asked for has to win.
 *
 * @param {Object} deadline - Deadline from {@link createDeadline}, or null for no bound
 * @param {Function} run - Zero-argument function returning a promise
 * @returns {Promise<{timedOut: boolean, value: *}>} Outcome, or expiry
 */
export async function runWithinDeadline(deadline, run) {
  if (!deadline) {
    return { timedOut: false, value: await run() };
  }

  const remaining = deadline.remainingMs();
  if (remaining <= 0) {
    return { timedOut: true, value: undefined };
  }

  const operation = run();
  // An abandoned operation still settles on its own schedule. Handle its
  // rejection up front so it cannot surface as an unhandled one after the
  // deadline has already won the race.
  Promise.resolve(operation).catch(() => {});

  let timer;
  const expiry = new Promise((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE_REACHED), remaining);
  });

  try {
    const outcome = await Promise.race([operation, expiry]);
    if (outcome === DEADLINE_REACHED) {
      return { timedOut: true, value: undefined };
    }
    return { timedOut: false, value: outcome };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the engine adapter a check needs, building it lazily when the caller
 * only supplied a factory.
 *
 * @param {Object} context - Check context
 * @returns {Promise<Object>} Engine adapter
 */
async function resolveAdapter(context) {
  const adapter = context.adapter ?? (await context.getAdapter?.());
  if (!adapter) {
    throw new Error('readiness check requires an engine adapter');
  }
  return adapter;
}

function normalizeSampleResult(value) {
  if (typeof value === 'boolean') {
    return { stable: value, detail: {} };
  }
  return { stable: Boolean(value?.stable), detail: value?.detail ?? {} };
}

/**
 * Build a check that requires a sampler to report stability for a period.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.name - Check name reported in evidence
 * @param {Function} options.sample - Async sampler returning boolean or {stable, detail}
 * @param {number} [options.stableForMs=500] - How long the sampler must stay stable
 * @param {number} [options.intervalMs=100] - Sampling interval
 * @param {number} [options.consecutiveSamples=1] - Extra consecutive stable samples required
 * @returns {{name: string, run: Function}} Readiness check
 */
export function stableCheck(options = {}) {
  const {
    name,
    sample,
    stableForMs = 500,
    intervalMs = 100,
    consecutiveSamples = 1,
  } = options;

  if (!name || typeof sample !== 'function') {
    throw new TypeError('stableCheck requires a name and a sample function');
  }

  return {
    name,
    async run(context) {
      const { deadline } = context;
      let stableSince = null;
      let streak = 0;
      let lastDetail = {};

      while (!deadline.expired()) {
        const { stable, detail } = normalizeSampleResult(await sample(context));
        lastDetail = detail;

        if (stable) {
          streak += 1;
          stableSince ??= deadline.elapsedMs();
          const heldFor = deadline.elapsedMs() - stableSince;
          if (heldFor >= stableForMs && streak >= consecutiveSamples) {
            return {
              satisfied: true,
              detail: { ...lastDetail, heldForMs: heldFor },
            };
          }
        } else {
          stableSince = null;
          streak = 0;
        }

        if (deadline.remainingMs() === 0) {
          break;
        }
        await sleepWithinDeadline(intervalMs, deadline);
      }

      return {
        satisfied: false,
        detail: { ...lastDetail, reason: 'deadline reached' },
      };
    },
  };
}

/**
 * Require the page URL to stop changing for a period.
 *
 * @param {Object} [options] - Configuration options
 * @param {number} [options.stableForMs=1000] - Required quiet period
 * @param {number} [options.intervalMs=200] - Sampling interval
 * @param {number} [options.consecutiveSamples=1] - Extra consecutive stable samples
 * @returns {{name: string, run: Function}} Readiness check
 */
export function urlStableFor(options = {}) {
  const {
    stableForMs = 1000,
    intervalMs = 200,
    consecutiveSamples = 1,
  } = options;
  let lastUrl;

  return stableCheck({
    name: 'urlStableFor',
    stableForMs,
    intervalMs,
    consecutiveSamples,
    sample: ({ page, onUrlSample }) => {
      const url = page.url();
      onUrlSample?.(url);
      const stable = lastUrl === undefined ? false : url === lastUrl;
      lastUrl = url;
      return { stable, detail: { url } };
    },
  });
}

/**
 * Require the network tracker to report idle within the remaining budget.
 *
 * @param {Object} [options] - Configuration options
 * @param {number} [options.idleForMs] - Idle window, defaults to the tracker's own
 * @returns {{name: string, run: Function}} Readiness check
 */
export function networkIdleFor(options = {}) {
  const { idleForMs } = options;

  return {
    name: 'networkIdleFor',
    async run({ deadline, networkTracker }) {
      if (!networkTracker) {
        return { skipped: true, detail: { reason: 'no network tracker' } };
      }

      const timeout = deadline.remainingMs();
      if (timeout === 0) {
        return { satisfied: false, detail: { reason: 'no remaining budget' } };
      }

      const idle = await networkTracker.waitForNetworkIdle({
        timeout,
        ...(idleForMs === undefined ? {} : { idleTime: idleForMs }),
      });

      return {
        satisfied: Boolean(idle),
        detail: {
          pendingCount: networkTracker.getPendingCount?.() ?? null,
          pendingUrls: idle ? [] : (networkTracker.getPendingUrls?.() ?? []),
        },
      };
    },
  };
}

/**
 * Require the DOM to stop mutating for a period. Uses a cheap structural
 * fingerprint so it works identically on both engines and needs no injection.
 *
 * @param {Object} [options] - Configuration options
 * @param {number} [options.stableForMs=500] - Required quiet period
 * @param {number} [options.intervalMs=100] - Sampling interval
 * @param {number} [options.consecutiveSamples=2] - Extra consecutive stable samples
 * @returns {{name: string, run: Function}} Readiness check
 */
export function domStableFor(options = {}) {
  const {
    stableForMs = 500,
    intervalMs = 100,
    consecutiveSamples = 2,
  } = options;
  let lastFingerprint;

  return stableCheck({
    name: 'domStableFor',
    stableForMs,
    intervalMs,
    consecutiveSamples,
    sample: async (context) => {
      const adapter = await resolveAdapter(context);
      const fingerprint = await adapter.evaluateOnPage(() => {
        const { body } = document;
        return {
          nodes: document.getElementsByTagName('*').length,
          length: body ? body.innerHTML.length : 0,
          readyState: document.readyState,
        };
      });
      const key = `${fingerprint.nodes}:${fingerprint.length}`;
      const stable =
        lastFingerprint === key && fingerprint.readyState !== 'loading';
      lastFingerprint = key;
      return { stable, detail: fingerprint };
    },
  });
}

/**
 * Require every image currently in the viewport to have finished decoding.
 *
 * @param {Object} [options] - Configuration options
 * @param {number} [options.intervalMs=150] - Sampling interval
 * @returns {{name: string, run: Function}} Readiness check
 */
export function visibleImages(options = {}) {
  const { intervalMs = 150 } = options;

  return stableCheck({
    name: 'visibleImages',
    stableForMs: 0,
    intervalMs,
    consecutiveSamples: 1,
    sample: async (context) => {
      const adapter = await resolveAdapter(context);
      const state = await adapter.evaluateOnPage(() => {
        const images = [...document.images];
        const inViewport = images.filter((image) => {
          const box = image.getBoundingClientRect();
          return (
            box.bottom > 0 &&
            box.right > 0 &&
            box.top < window.innerHeight &&
            box.left < window.innerWidth
          );
        });
        return {
          total: inViewport.length,
          pending: inViewport.filter((image) => !image.complete).length,
        };
      });
      return { stable: state.pending === 0, detail: state };
    },
  });
}

/**
 * Wrap a caller-supplied predicate as a readiness check.
 *
 * @param {Object} options - Configuration options
 * @param {Function} options.fn - Predicate receiving the check context
 * @param {string} [options.name='predicate'] - Name reported in evidence
 * @param {number} [options.intervalMs=100] - Polling interval
 * @returns {{name: string, run: Function}} Readiness check
 */
export function predicate(options = {}) {
  const { fn, name = 'predicate', intervalMs = 100 } = options;

  if (typeof fn !== 'function') {
    throw new TypeError('predicate requires a function');
  }

  return stableCheck({
    name,
    stableForMs: 0,
    intervalMs,
    consecutiveSamples: 1,
    sample: async (context) => ({ stable: Boolean(await fn(context)) }),
  });
}

/**
 * Run readiness checks in order against a single deadline and report evidence.
 *
 * Checks run to completion even after one fails, so the result explains the
 * whole picture rather than only the first problem. Checks that never started
 * are reported as pending, which is what tells a caller the wait was cut short
 * rather than genuinely unsatisfied.
 *
 * @param {Object} options - Configuration options
 * @param {Array} options.checks - Readiness checks to run
 * @param {Object} options.deadline - Deadline from {@link createDeadline}
 * @param {Object} options.context - Context handed to every check
 * @returns {Promise<Object>} Structured readiness result
 */
export async function runReadinessChecks(options = {}) {
  const { checks = [], deadline, context = {} } = options;

  const satisfied = [];
  const failed = [];
  const skipped = [];
  const pending = [];
  const evidence = [];

  for (const [index, check] of checks.entries()) {
    if (deadline.expired() && failed.length > 0) {
      pending.push(...checks.slice(index).map((entry) => entry.name));
      break;
    }

    const startedAtMs = deadline.elapsedMs();
    let outcome;
    try {
      outcome = await check.run({ ...context, deadline });
    } catch (error) {
      outcome = { satisfied: false, detail: { error: error.message } };
    }

    const record = {
      name: check.name,
      satisfied: Boolean(outcome.satisfied),
      skipped: Boolean(outcome.skipped),
      startedAtMs,
      elapsedMs: deadline.elapsedMs() - startedAtMs,
      detail: outcome.detail ?? {},
    };
    evidence.push(record);

    if (record.skipped) {
      skipped.push(check.name);
    } else if (record.satisfied) {
      satisfied.push(check.name);
    } else {
      failed.push(check.name);
    }
  }

  const ready = failed.length === 0 && pending.length === 0;
  const timedOut = !ready && deadline.expired();

  return {
    status: ready
      ? READINESS_STATUS.READY
      : timedOut
        ? READINESS_STATUS.TIMED_OUT
        : READINESS_STATUS.FAILED,
    ready,
    checks: { satisfied, failed, skipped, pending },
    evidence,
    elapsedMs: deadline.elapsedMs(),
    timeoutMs: deadline.timeoutMs,
  };
}
