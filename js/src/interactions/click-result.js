/**
 * Truthful result model for click operations.
 *
 * The old model answered every click with two booleans, and both of them were
 * optimistic: a button that did nothing still reported `verified: true`. This
 * model separates three questions that used to be conflated - did we dispatch
 * the click, did the page react, and how did the operation end - and records
 * the evidence behind each answer.
 */

import { randomUUID } from 'node:crypto';

/** How a click operation ended. */
export const CLICK_STATUS = Object.freeze({
  /** Click dispatched and its effect was confirmed. */
  SUCCEEDED: 'succeeded',
  /** Click could not be dispatched, or dispatch provably failed. */
  FAILED: 'failed',
  /** The operation ran out of its budget. */
  TIMED_OUT: 'timed_out',
  /** Navigation or an explicit stop cut the operation short. */
  INTERRUPTED: 'interrupted',
  /** Click dispatched, but nothing confirmed or denied that it had an effect. */
  UNVERIFIED: 'unverified',
});

/** What the page did in response to the click. */
export const CLICK_EFFECT = Object.freeze({
  /** Observed evidence that the click did something. */
  CONFIRMED: 'confirmed',
  /** No evidence either way. */
  NOT_OBSERVED: 'not-observed',
  /** Observed evidence that the click did NOT do what was expected. */
  CONTRADICTED: 'contradicted',
});

/**
 * Build one piece of evidence for a click or readiness decision.
 *
 * @param {string} type - Evidence kind, e.g. 'element-state' or 'navigation'
 * @param {Object} [detail] - Arbitrary structured detail
 * @returns {{type: string, detail: Object}} Evidence entry
 */
export function evidence(type, detail = {}) {
  return { type, detail };
}

/**
 * Build a click result, deriving the legacy booleans conservatively.
 *
 * `verified` is deliberately derived from `effect === 'confirmed'` rather than
 * from "nothing went wrong", which is what made the old value meaningless.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.status - One of {@link CLICK_STATUS}
 * @param {boolean} [options.dispatched=false] - Whether the click reached the element
 * @param {string} [options.effect] - One of {@link CLICK_EFFECT}
 * @param {Array} [options.evidence] - Evidence entries
 * @param {number} [options.elapsedMs=0] - Duration of the operation
 * @param {string} [options.reason=''] - Human-readable summary
 * @param {boolean} [options.navigated=false] - Whether navigation was attributed to this click
 * @param {string} [options.actionId] - Correlation ID for this click
 * @returns {Object} Click result
 */
export function makeClickResult(options = {}) {
  const {
    status,
    dispatched = false,
    effect = CLICK_EFFECT.NOT_OBSERVED,
    evidence: evidenceList = [],
    elapsedMs = 0,
    reason = '',
    navigated = false,
    actionId,
    ...rest
  } = options;

  return {
    status,
    dispatched,
    effect,
    evidence: evidenceList,
    elapsedMs,
    reason,
    navigated,
    ...(actionId === undefined ? {} : { actionId }),

    // Legacy booleans, kept so existing callers keep working - but now derived
    // from what was actually observed.
    clicked: dispatched,
    verified: effect === CLICK_EFFECT.CONFIRMED,
    ...rest,
  };
}

/**
 * Mint a correlation ID so navigation evidence can be tied to one click.
 *
 * The random half comes from the system CSPRNG rather than `Math.random()`.
 * The ID is only a correlation key, but it travels into logs and trace
 * bundles, where a reader cannot tell a correlation key from a token; taking
 * the characters from `randomUUID` costs nothing and settles the question.
 *
 * @returns {string} Opaque action ID
 */
export function nextActionId() {
  return `click-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}
