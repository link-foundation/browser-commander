/**
 * Raw Chrome DevTools Protocol sessions with one surface for both engines
 * (issue #104).
 *
 * Rust has chromiumoxide and raw CDP; this module gives JavaScript the same
 * `cdpSession` API: `send(method, params)`, `on(event, fn)`, `off(event, fn)`
 * and `detach()`, whether the page belongs to Playwright or Puppeteer.
 */
import { detectEngine } from '../core/engine-detection.js';
import { createCdpSession as openEngineCdpSession } from '../fingerprint/apply.js';

/**
 * Wrap an engine CDP session in the uniform surface.
 *
 * @param {Object} session - Playwright or Puppeteer `CDPSession`
 * @param {'playwright'|'puppeteer'} engine
 * @returns {CdpSession}
 */
export function wrapCdpSession(session, engine) {
  let detached;
  const wrapper = {
    engine,
    /** The engine's own `CDPSession`, for anything not covered here. */
    session,
    /** Send a CDP command and resolve with its result. */
    send: (method, params = {}) => session.send(method, params),
    /** Listen to a CDP event, such as `Network.requestWillBeSent`. */
    on(event, listener) {
      session.on(event, listener);
      return wrapper;
    },
    /** Listen to one occurrence of a CDP event. */
    once(event, listener) {
      session.once(event, listener);
      return wrapper;
    },
    /** Stop listening to a CDP event. */
    off(event, listener) {
      session.off(event, listener);
      return wrapper;
    },
    /** Detach the session; calling it again is a no-op. */
    detach() {
      detached ??= Promise.resolve(session.detach());
      return detached;
    },
  };
  return wrapper;
}

function isLegacyOptions(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    'page' in value &&
    typeof value.goto !== 'function'
  );
}

/**
 * Open a raw CDP session for a page.
 *
 * Playwright opens it with `page.context().newCDPSession(page)`, Puppeteer
 * with `page.createCDPSession()`. Both are returned with the same methods.
 * The older `createCdpSession({browser, page, engine})` form is accepted too.
 *
 * @param {Object} page - Playwright or Puppeteer page
 * @param {Object} [options]
 * @param {'playwright'|'puppeteer'} [options.engine] - Detected from the page when omitted
 * @param {Object} [options.browser] - Playwright context to open the session on
 * @returns {Promise<CdpSession>}
 *
 * @typedef {Object} CdpSession
 * @property {string} engine
 * @property {Object} session
 * @property {function(string, Object=): Promise<Object>} send
 * @property {function(string, Function): CdpSession} on
 * @property {function(string, Function): CdpSession} once
 * @property {function(string, Function): CdpSession} off
 * @property {function(): Promise<void>} detach
 */
export async function createCdpSession(page, options = {}) {
  const request = isLegacyOptions(page) ? page : { ...options, page };
  if (!request.page) {
    throw new Error('createCdpSession requires a page');
  }
  const engine = request.engine ?? detectEngine(request.page);
  const session = await openEngineCdpSession({
    browser: request.browser,
    page: request.page,
    engine,
  });
  return wrapCdpSession(session, engine);
}
