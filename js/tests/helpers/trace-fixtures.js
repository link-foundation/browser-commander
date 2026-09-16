/**
 * Fixtures for the trace tests (issue #87).
 *
 * The fake page answers the few calls the recorder makes — evaluate a capture
 * function, take a screenshot, emit an engine event — so the recorder's own
 * behaviour is tested without a browser. The functions that run *inside* a
 * page are proven against real engines in `tests/e2e/traces.e2e.test.js`.
 */

import { EventEmitter } from 'node:events';
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
 * @param {Object} [options] - `{snapshot, mutations, screenshot}`
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
    failures: new Map(),
  };

  return {
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
        return { batches, dropped, installed: true };
      }
      return true;
    },
    screenshot: async () => {
      state.screenshots += 1;
      return state.screenshot;
    },
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    emit: (event, payload) => emitter.emit(event, payload),
    listenerCount: (event) => emitter.listenerCount(event),
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
