/**
 * DialogManager - Centralized dialog/alert event handling
 *
 * This module provides:
 * - Unified dialog event handling for Playwright and Puppeteer
 * - Session-aware handler registration (auto-cleanup on navigation)
 * - Support for alert, confirm, prompt, and beforeunload dialogs
 *
 * Both Playwright and Puppeteer expose page.on('dialog', handler)
 * with a Dialog object that has accept(), dismiss(), message(), and type().
 */

/**
 * Create a DialogManager instance for a page
 * @param {Object} options - Configuration options
 * @param {Object} options.page - Playwright or Puppeteer page object
 * @param {string} options.engine - 'playwright' or 'puppeteer'
 * @param {Function} options.log - Logger instance
 * @returns {Object} - DialogManager API
 */
export function createDialogManager(options = {}) {
  const { page, engine, log } = options;

  if (!page) {
    throw new Error('page is required in options');
  }

  // User-registered dialog handlers
  const handlers = [];

  // Whether we are currently listening to the page's dialog event
  let isListening = false;

  /**
   * Internal handler that is registered on the page.
   * It calls all user-registered handlers in order.
   * If no handler has accepted/dismissed the dialog after all handlers run,
   * we auto-dismiss to prevent the page from freezing.
   */
  async function handleDialog(dialog) {
    const type =
      typeof dialog.type === 'function' ? dialog.type() : dialog.type;
    const message =
      typeof dialog.message === 'function' ? dialog.message() : dialog.message;

    log.debug(() => `💬 Dialog event: type="${type}", message="${message}"`);

    if (handlers.length === 0) {
      log.debug(
        () =>
          `⚠️  No dialog handlers registered — auto-dismissing "${type}" dialog`
      );
      try {
        await dialog.dismiss();
      } catch (e) {
        log.debug(() => `⚠️  Failed to auto-dismiss dialog: ${e.message}`);
      }
      return;
    }

    let handled = false;

    for (const fn of handlers) {
      try {
        await fn(dialog);
        handled = true;
      } catch (e) {
        log.debug(() => `⚠️  Error in dialog handler: ${e.message}`);
      }
    }

    // Safety net: if no handler successfully ran, auto-dismiss
    if (!handled) {
      log.debug(
        () =>
          `⚠️  All dialog handlers failed — auto-dismissing "${type}" dialog`
      );
      try {
        await dialog.dismiss();
      } catch (e) {
        log.debug(() => `⚠️  Failed to auto-dismiss dialog: ${e.message}`);
      }
    }
  }

  /**
   * Add a dialog event handler
   * @param {Function} handler - Async function receiving (dialog) object
   *   dialog.type()    → 'alert' | 'confirm' | 'prompt' | 'beforeunload'
   *   dialog.message() → The dialog message text
   *   dialog.accept(text?) → Accept / confirm (optional text for prompts)
   *   dialog.dismiss() → Dismiss / cancel the dialog
   */
  function onDialog(handler) {
    if (typeof handler !== 'function') {
      throw new Error('Dialog handler must be a function');
    }
    handlers.push(handler);
    log.debug(() => `🔌 Dialog handler registered (total: ${handlers.length})`);
  }

  /**
   * Remove a dialog event handler
   * @param {Function} handler - The handler function to remove
   */
  function offDialog(handler) {
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
      log.debug(
        () => `🔌 Dialog handler removed (remaining: ${handlers.length})`
      );
    }
  }

  /**
   * Remove all dialog event handlers
   */
  function clearDialogHandlers() {
    handlers.length = 0;
    log.debug(() => '🔌 All dialog handlers cleared');
  }

  /**
   * Start listening for dialog events on the page
   */
  function startListening() {
    if (isListening) {
      return;
    }
    page.on('dialog', handleDialog);
    isListening = true;
    log.debug(() => '🔌 Dialog manager started');
  }

  /**
   * Stop listening for dialog events on the page
   */
  function stopListening() {
    if (!isListening) {
      return;
    }
    page.off('dialog', handleDialog);
    isListening = false;
    log.debug(() => '🔌 Dialog manager stopped');
  }

  return {
    // Handler registration
    onDialog,
    offDialog,
    clearDialogHandlers,

    // Lifecycle
    startListening,
    stopListening,
  };
}
