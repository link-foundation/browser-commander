/**
 * Fixtures for the trace tests (issue #87).
 *
 * The fake page answers the few calls the recorder makes — evaluate a capture
 * function, take a screenshot, emit an engine event — so the recorder's own
 * behaviour is tested without a browser. The functions that run *inside* a
 * page are proven against real engines in `tests/e2e/traces.e2e.test.js`.
 */

import { EventEmitter } from 'node:events';
import { afterEach } from 'node:test';
import { useTempDirectory } from './temp-directory.js';

/**
 * Give a suite its own directory for trace bundles.
 *
 * @returns {{path: string}} Holder whose `path` is the current directory
 */
export function useTempTraceDirectory() {
  return useTempDirectory('bc-traces-');
}

/**
 * Close every bundle a test opened, including deliberately truncated ones.
 *
 * @returns {(bundle: Object) => Object} Tracker for an opened bundle
 */
export function useTraceBundleCleanup() {
  const bundles = new Set();
  afterEach(async () => {
    await Promise.all([...bundles].map((bundle) => bundle.abort()));
    bundles.clear();
  });
  return (bundle) => {
    bundles.add(bundle);
    return bundle;
  };
}

/**
 * A snapshot shaped like the one the in-page capture returns.
 *
 * @param {Object} [overrides] - Fields to replace
 * @returns {Object} `{html, state, truncated}`
 */
export function makeSnapshot(overrides = {}) {
  const { state: stateOverrides, ...rest } = overrides;
  return {
    html: '<!DOCTYPE html>\n<html><body><p>captured</p></body></html>',
    truncated: false,
    ...rest,
    state: {
      url: 'https://example.com/report',
      title: 'Report',
      readyState: 'complete',
      scroll: { x: 0, y: 0 },
      viewport: { width: 1280, height: 720 },
      activeElement: null,
      controls: [
        { path: 'form > input', tag: 'input', type: 'text', value: 'alice' },
      ],
      frames: [],
      ...stateOverrides,
    },
  };
}

/**
 * Create a fake page the recorder can drive.
 *
 * @param {Object} [options] - `{snapshot, mutations, screenshot, frames}`
 * @param {Object[]} [options.frames] - Extra frames, each `{mutations}`; the
 *   page itself is always the main frame, and a page given no frames has no
 *   `frames()` at all, the way a page object from neither engine would
 * @returns {Object} The fake page
 */
export function createFakePage(options = {}) {
  const emitter = new EventEmitter();
  const state = {
    snapshot: options.snapshot ?? makeSnapshot(),
    mutations: options.mutations ? [...options.mutations] : [],
    droppedMutations: options.droppedMutations ?? 0,
    screenshot: options.screenshot ?? Buffer.from('fake-png'),
    screenshots: 0,
    evaluated: [],
    initScripts: [],
    failures: new Map(),
  };

  const page = {
    state,
    /**
     * Make one in-page call fail, the way a closed page does.
     *
     * @param {string} name - In-page function name
     * @param {Error|string} failure - What it should throw
     * @returns {void}
     */
    failEvaluate(name, failure) {
      state.failures.set(
        name,
        failure instanceof Error ? failure : new Error(failure)
      );
    },
    /**
     * Replace what the next capture returns.
     *
     * @param {Object} snapshot - A snapshot from `makeSnapshot()`
     * @returns {void}
     */
    setSnapshot(snapshot) {
      state.snapshot = snapshot;
    },
    /**
     * Queue mutation batches for the next drain.
     *
     * @param {Object[]} batches - Ordered batches
     * @returns {void}
     */
    queueMutations(batches) {
      state.mutations.push(...batches);
    },
    evaluate: async (fn, argument) => {
      const name = typeof fn === 'function' ? fn.name : String(fn);
      state.evaluated.push({ name, argument });
      const failure = state.failures.get(name);
      if (failure) {
        throw failure;
      }
      if (name === 'captureSnapshotInPage') {
        return state.snapshot;
      }
      if (name === 'drainMutationsInPage') {
        const batches = state.mutations.splice(0, state.mutations.length);
        const dropped = state.droppedMutations;
        state.droppedMutations = 0;
        return {
          batches: batches.map((batch) => ({
            frameId: 'main',
            mainFrame: true,
            ...batch,
          })),
          dropped,
          installed: true,
          frameId: 'main',
          mainFrame: true,
        };
      }
      return true;
    },
    screenshot: async () => {
      state.screenshots += 1;
      return state.screenshot;
    },
    /**
     * Register a script for every future document, the Playwright spelling.
     *
     * @param {Function} fn - The function to run
     * @param {*} argument - Its argument
     * @returns {Promise<void>} Resolves once registered
     */
    addInitScript: async (fn, argument) => {
      state.initScripts.push({
        name: typeof fn === 'function' ? fn.name : String(fn),
        argument,
      });
    },
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    emit: (event, payload) => emitter.emit(event, payload),
    listenerCount: (event) => emitter.listenerCount(event),
  };

  if (options.frames) {
    const children = options.frames.map((frame, index) =>
      createFakeFrame(state, frame, `child-${index + 1}`)
    );
    page.frames = () => [
      createFakeFrame(state, null, 'main', page),
      ...children,
    ];
  }

  return page;
}

/**
 * One frame of a fake page.
 *
 * The main frame answers out of the page's own state, so a page with frames
 * behaves exactly like one without for everything except the extra documents.
 *
 * @param {Object} state - The page's state
 * @param {Object|null} frame - `{mutations, dropped}` for a child frame
 * @param {string} frameId - What this frame calls itself
 * @param {Object} [page] - The page, when this is the main frame
 * @returns {Object} A frame with `evaluate`
 */
function createFakeFrame(state, frame, frameId, page) {
  if (page) {
    return { evaluate: page.evaluate };
  }
  const queued = frame?.mutations ? [...frame.mutations] : [];
  return {
    evaluate: async (fn, argument) => {
      const name = typeof fn === 'function' ? fn.name : String(fn);
      state.evaluated.push({ name, argument, frameId });
      if (name === 'drainMutationsInPage') {
        return {
          batches: queued
            .splice(0, queued.length)
            .map((batch) => ({ frameId, mainFrame: false, ...batch })),
          dropped: frame?.dropped ?? 0,
          installed: true,
          frameId,
          mainFrame: false,
        };
      }
      return true;
    },
  };
}

/**
 * Create a fake commander around a fake page.
 *
 * @param {Object} page - The page from `createFakePage()`
 * @param {Object} [extras] - Extra commander properties, such as `downloads`
 * @returns {Object} The fake commander
 */
export function createFakeCommander(page, extras = {}) {
  return {
    page,
    engine: 'playwright',
    evaluate: (fn, argument) => page.evaluate(fn, argument),
    click: async (selector) => ({ clicked: selector }),
    goto: async (url) => ({ url }),
    typeText: async (selector, text) => ({ selector, text }),
    ...extras,
  };
}

/**
 * A download manager's subscription surface, without a browser.
 *
 * @returns {Object} `{on, off, emit, listenerCount}`
 */
export function createFakeDownloads() {
  // The manager's subscription surface is an emitter's, so a plain one is the
  // fixture: `on`, `off` and `listenerCount` are the calls the recorder makes.
  return new EventEmitter();
}

/**
 * A dialog manager's observation surface, without a browser.
 *
 * `raise()` plays the manager's own rule back: observers are told, and a
 * dialog nobody answered is dismissed rather than left blocking the page.
 *
 * @returns {Object} `{observeDialogs, unobserveDialogs, observerCount, raise}`
 */
export function createFakeDialogManager() {
  const observers = [];

  return {
    observeDialogs: (observer) => observers.push(observer),
    unobserveDialogs: (observer) => {
      const index = observers.indexOf(observer);
      if (index !== -1) {
        observers.splice(index, 1);
      }
    },
    observerCount: () => observers.length,
    raise: async ({ type, message }) => {
      const dialog = {
        dismissed: false,
        type: () => type,
        message: () => message,
        dismiss: async () => {
          dialog.dismissed = true;
        },
      };
      for (const observer of observers) {
        await observer(dialog);
      }
      if (!dialog.dismissed) {
        await dialog.dismiss();
      }
      return dialog;
    },
  };
}
