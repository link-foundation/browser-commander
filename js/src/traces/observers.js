/**
 * The observers behind a trace's shared timeline (issue #87).
 *
 * Navigation, Browser Commander interactions, console output, page errors,
 * dialogs, failed requests and downloads are reported by different objects in
 * different engines. They all end up as records on one ordered timeline, and
 * this module is the only place that knows how each of them is reached.
 */

import { TRACE_EVENT } from './schema.js';

/** Commander methods recorded as interactions while a trace is running. */
export const TRACED_INTERACTIONS = Object.freeze([
  'click',
  'clickButton',
  'fill',
  'fillTextArea',
  'goto',
  'pressKey',
  'typeText',
  'setContent',
  'scrollIntoView',
]);

/**
 * What an interaction was aimed at.
 *
 * A selector and a URL are the useful part of an interaction; typed text is
 * never taken, because that is where passwords are. Most commander methods
 * take an options object, and a few legacy ones take the selector directly,
 * so both shapes are read here.
 *
 * @param {*} argument - The interaction's first argument
 * @returns {string|null} The selector or URL it acted on
 */
export function interactionTarget(argument) {
  if (typeof argument === 'string') {
    return argument;
  }
  if (!argument || typeof argument !== 'object') {
    return null;
  }
  for (const key of ['selector', 'url', 'locatorOrElement']) {
    if (typeof argument[key] === 'string') {
      return argument[key];
    }
  }
  return null;
}

/**
 * Subscribe to everything a running trace listens to.
 *
 * @param {Object} options - `{commander, page, eventSources, record, note, identity}`
 * @param {Object} [options.commander] - The commander being traced, when there
 *   is one; interactions and managed downloads are reached through it
 * @param {Object} options.page - The page being traced
 * @param {string[]} options.eventSources - Sources the caller asked for
 * @param {Function} options.record - Writes one timeline record
 * @param {Function} options.note - Reports an observer that could not attach
 * @param {Object} [options.identity] - Trace identity, see `identity.js`; the
 *   navigation observer is what moves it on to the next navigation, and the
 *   interaction observer is what names an action (issue #93)
 * @returns {Function[]} One detach function per attached observer
 */
export function attachTimelineObservers(options) {
  const { commander, page, eventSources, record, note, identity } = options;
  const detachers = [];

  function subscribe(source, attach) {
    if (!eventSources.includes(source)) {
      return;
    }
    try {
      const detach = attach();
      if (typeof detach === 'function') {
        detachers.push(detach);
      }
    } catch (error) {
      note(`could not observe ${source}: ${error.message}`);
    }
  }

  function onPage(eventName, listener) {
    page.on?.(eventName, listener);
    return () =>
      page.off?.(eventName, listener) ??
      page.removeListener?.(eventName, listener);
  }

  subscribe('navigation', () => {
    const manager = commander?.navigationManager;
    if (!manager) {
      // Without the manager the engine's own event still gives ordering.
      return onPage('framenavigated', (frame) => {
        const isMain =
          typeof frame?.parentFrame === 'function'
            ? frame.parentFrame() === null
            : true;
        // A record's navigation is the one it happened during, so the counter
        // moves on before the record that reports the move is written.
        const navigationId = isMain
          ? identity?.navigated()
          : identity?.navigationId;
        void record(TRACE_EVENT.NAVIGATION, {
          phase: 'framenavigated',
          navigationId,
          mainFrame: isMain,
          url: typeof frame?.url === 'function' ? frame.url() : String(frame),
        });
      });
    }
    const started = (info) =>
      void record(TRACE_EVENT.NAVIGATION, { phase: 'start', ...info });
    const completed = (info) =>
      void record(TRACE_EVENT.NAVIGATION, {
        phase: 'complete',
        // Everything recorded after this belongs to the document that just
        // loaded, which is the distinction a replay needs to stop mixing two
        // pages' changes together (issue #93).
        navigationId: identity?.navigated(),
        ...info,
      });
    const changed = (info) =>
      void record(TRACE_EVENT.NAVIGATION, { phase: 'urlchange', ...info });
    manager.on('onNavigationStart', started);
    manager.on('onNavigationComplete', completed);
    manager.on('onUrlChange', changed);
    return () => {
      manager.off?.('onNavigationStart', started);
      manager.off?.('onNavigationComplete', completed);
      manager.off?.('onUrlChange', changed);
    };
  });

  subscribe('console', () =>
    onPage('console', (message) => {
      void record(TRACE_EVENT.CONSOLE, {
        level: typeof message?.type === 'function' ? message.type() : null,
        text:
          typeof message?.text === 'function'
            ? message.text()
            : String(message),
      });
    })
  );

  subscribe('pageerror', () =>
    onPage('pageerror', (error) => {
      void record(TRACE_EVENT.PAGE_ERROR, {
        message: error?.message ?? String(error),
        stack: error?.stack ?? null,
      });
    })
  );

  subscribe('requestfailed', () =>
    onPage('requestfailed', (request) => {
      void record(TRACE_EVENT.REQUEST_FAILED, {
        url: typeof request?.url === 'function' ? request.url() : null,
        method: typeof request?.method === 'function' ? request.method() : null,
        failure:
          typeof request?.failure === 'function'
            ? (request.failure()?.errorText ?? null)
            : null,
      });
    })
  );

  subscribe('dialog', () => {
    const manager = commander?.dialogManager;
    if (!manager?.observeDialogs && !manager?.onDialog) {
      return null;
    }
    const listener = (dialog) => {
      void record(TRACE_EVENT.DIALOG, {
        type: typeof dialog?.type === 'function' ? dialog.type() : null,
        message:
          typeof dialog?.message === 'function' ? dialog.message() : null,
      });
    };
    // Recording a dialog must not decide what happens to it: a passive
    // observer leaves the manager's auto-dismissal in place, so a traced run
    // answers dialogs exactly the way the same untraced run would.
    if (manager.observeDialogs) {
      manager.observeDialogs(listener);
      return () => manager.unobserveDialogs?.(listener);
    }
    manager.onDialog(listener);
    return () => manager.offDialog?.(listener);
  });

  subscribe('download', () => {
    const downloads = commander?.downloads;
    if (!downloads?.on) {
      return null;
    }
    const listeners = ['started', 'completed', 'failed', 'cancelled'].map(
      (phase) => {
        const listener = (artifact) => {
          void record(TRACE_EVENT.DOWNLOAD, {
            phase,
            id: artifact?.id ?? null,
            // The path and checksum are the reference; the bytes stay where
            // the download manager put them.
            suggestedFilename: artifact?.suggestedFilename ?? null,
            path: artifact?.path ?? null,
            checksum: artifact?.checksum ?? null,
            bytes: artifact?.bytes ?? null,
            url: artifact?.url ?? null,
            failure: artifact?.failure ?? null,
          });
        };
        downloads.on(phase, listener);
        return [phase, listener];
      }
    );
    return () => {
      for (const [phase, listener] of listeners) {
        downloads.off?.(phase, listener);
      }
    };
  });

  subscribe('interaction', () => {
    if (!commander) {
      return null;
    }
    const originals = new Map();
    for (const name of TRACED_INTERACTIONS) {
      const original = commander[name];
      if (typeof original !== 'function') {
        continue;
      }
      originals.set(name, original);
      commander[name] = async (...args) => {
        const startedMs = Date.now();
        const target = interactionTarget(args[0]);
        // Named before the call, so everything the action causes can be traced
        // back to it even when the action itself ends in an exception.
        const actionId = identity?.nextActionId() ?? null;
        try {
          const result = await original(...args);
          await record(TRACE_EVENT.INTERACTION, {
            actionId,
            action: name,
            target,
            durationMs: Date.now() - startedMs,
            ok: true,
          });
          return result;
        } catch (error) {
          await record(TRACE_EVENT.INTERACTION, {
            actionId,
            action: name,
            target,
            durationMs: Date.now() - startedMs,
            ok: false,
            error: error.message,
          });
          throw error;
        }
      };
    }
    return () => {
      for (const [name, original] of originals) {
        commander[name] = original;
      }
    };
  });
  return detachers;
}
