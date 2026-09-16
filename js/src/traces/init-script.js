/**
 * Getting the in-page recorder in before the page's own code (issue #93).
 *
 * A `MutationObserver` lives on the document, so a navigation destroys it. The
 * recorder used to be reinstalled from `checkpoint()`, which meant everything a
 * new page did while it was loading - the whole first render of a
 * single-page app, every `DOMContentLoaded` handler - happened before anything
 * was watching. Replaying such a trace showed a page that had apparently always
 * looked finished.
 *
 * Both engines can run a script at document creation, ahead of the page's own
 * scripts, in every frame. That hook is the only place an observer can be
 * installed early enough to see a document's first mutation, so this module
 * wraps the two spellings of it.
 */

/**
 * Which engine's init-script hook this page offers.
 *
 * The page is asked rather than the commander, because a caller may trace a raw
 * Playwright or Puppeteer page with no commander at all.
 *
 * @param {Object} page - The page being traced
 * @returns {string|null} 'playwright', 'puppeteer', or null when neither
 */
export function initScriptEngine(page) {
  if (typeof page?.addInitScript === 'function') {
    return 'playwright';
  }
  if (typeof page?.evaluateOnNewDocument === 'function') {
    return 'puppeteer';
  }
  return null;
}

/**
 * Run a function in every document this page creates from now on.
 *
 * Playwright offers no way to unregister a single init script, so the returned
 * detach is best-effort: it removes the registration on Puppeteer, and
 * everywhere else the trace relies on `stop()` switching the recorder off in
 * the documents that exist. A recorder installed into a document created after
 * `stop()` therefore queues into a queue nobody drains, bounded by the same
 * `maxQueuedMutations` limit as everything else.
 *
 * @param {Object} options - `{page, fn, arg, note}`
 * @returns {Promise<Function|null>} Detach, or null when the page has no hook
 */
export async function installInitScript(options) {
  const { page, fn, arg, note } = options;
  const engine = initScriptEngine(page);

  if (engine === 'playwright') {
    await page.addInitScript(fn, arg);
    return () => {};
  }

  if (engine === 'puppeteer') {
    const handle = await page.evaluateOnNewDocument(fn, arg);
    const identifier = handle?.identifier ?? handle;
    return async () => {
      if (identifier === undefined || identifier === null) {
        return;
      }
      try {
        await page.removeScriptToEvaluateOnNewDocument?.(identifier);
      } catch (error) {
        note?.(`could not remove the init script: ${error.message}`);
      }
    };
  }

  return null;
}

/**
 * Every frame of a page, including the page itself.
 *
 * Frames come and go while a trace is running, so this is read at the moment it
 * is needed rather than kept.
 *
 * @param {Object} page - The page being traced
 * @returns {Object[]} Frames, main frame first when the engine orders them so
 */
export function framesOf(page) {
  if (typeof page?.frames !== 'function') {
    return [];
  }
  try {
    return page.frames() ?? [];
  } catch {
    // A page that closed mid-drain has no frames, which is not an error here.
    return [];
  }
}
