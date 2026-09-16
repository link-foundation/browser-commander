/**
 * Stable identities for the things a trace talks about (issue #93).
 *
 * A timeline that says "a mutation happened" without saying *where* is only
 * readable when exactly one document existed. Two tabs, or one page with an
 * iframe, and every record becomes a guess. Issue #93 calls this out: "no
 * browser-context / page / navigation / frame / action identifiers", so every
 * record this recorder writes now names its owner.
 *
 * Identities are assigned here rather than taken from the engine because the
 * two engines name the same things differently, and a trace is supposed to
 * read the same whichever one recorded it. They are stable within a process:
 * tracing the same page twice reports the same `pageId`, which is what makes
 * two bundles of one run comparable.
 */

/** Identities already handed out, so the same object keeps the same name. */
const assigned = new WeakMap();

const counters = { context: 0, page: 0, trace: 0 };

/**
 * Name one engine object, stably.
 *
 * @param {Object|null|undefined} subject - The object to name
 * @param {string} kind - Counter to draw from, such as `page`
 * @param {string} prefix - Identifier prefix, such as `page`
 * @returns {string|null} The identifier, or null when there is nothing to name
 */
function identify(subject, kind, prefix) {
  if (
    !subject ||
    (typeof subject !== 'object' && typeof subject !== 'function')
  ) {
    return null;
  }
  const existing = assigned.get(subject);
  if (existing) {
    return existing;
  }
  const id = `${prefix}-${++counters[kind]}`;
  assigned.set(subject, id);
  return id;
}

/**
 * The browser context a page belongs to, whichever engine owns it.
 *
 * @param {Object} page - Playwright or Puppeteer page
 * @returns {Object|null} The context object, or null when it cannot be reached
 */
export function browserContextOf(page) {
  for (const accessor of ['context', 'browserContext']) {
    if (typeof page?.[accessor] === 'function') {
      try {
        return page[accessor]();
      } catch {
        // An engine that closed the page answers by throwing; an unnamed
        // context is better than a failed trace.
      }
    }
  }
  return null;
}

/**
 * Open an identity for one running trace.
 *
 * @param {Object} options - `{page}`
 * @param {Object} options.page - The page being traced
 * @returns {Object} The trace's identity
 */
export function createTraceIdentity({ page } = {}) {
  const traceId = `trace-${++counters.trace}`;
  const browserContextId = identify(
    browserContextOf(page),
    'context',
    'context'
  );
  const pageId = identify(page, 'page', 'page');

  // A navigation is what separates "the same element" from "an element with
  // the same path in a different document", so it is numbered from the start
  // rather than from the first navigation the recorder happens to see.
  let navigation = 1;
  let actions = 0;

  return {
    traceId,
    browserContextId,
    pageId,
    get navigationId() {
      return `nav-${navigation}`;
    },
    /**
     * Start a new navigation generation.
     *
     * @returns {string} The identifier of the document that is now current
     */
    navigated() {
      navigation += 1;
      return `nav-${navigation}`;
    },
    /**
     * Name one action, so its start, its result and its DOM effects agree.
     *
     * @returns {string} A fresh action identifier
     */
    nextActionId() {
      actions += 1;
      return `${traceId}-action-${actions}`;
    },
    /**
     * The owner fields every timeline record carries.
     *
     * @returns {Object} `{traceId, browserContextId, pageId, navigationId}`
     */
    owner() {
      return {
        traceId,
        browserContextId,
        pageId,
        navigationId: `nav-${navigation}`,
      };
    },
  };
}
