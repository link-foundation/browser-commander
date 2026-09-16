/**
 * Fixtures for the managed download tests (issue #88).
 *
 * The fake context speaks exactly the part of Playwright's download API the
 * manager uses, so the tests exercise the real event plumbing without needing
 * a browser.
 */

import { EventEmitter } from 'node:events';
import { setImmediate as yieldToEngine } from 'node:timers/promises';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  makeTempDirectory as makeDirectory,
  useTempDirectory,
} from './temp-directory.js';

/**
 * Create a temporary directory that a test can write downloads into.
 *
 * @returns {Promise<string>} Absolute directory path
 */
export async function makeTempDirectory() {
  return makeDirectory('bc-downloads-');
}

/**
 * Build a fake Playwright download whose bytes are already on disk.
 *
 * @param {Object} options - Download options
 * @param {string} options.dir - Directory to stage the bytes in
 * @param {string} options.suggestedFilename - Name the page suggested
 * @param {string|Buffer} [options.body] - File contents
 * @param {string} [options.url] - Source URL
 * @param {string} [options.failure] - Engine failure text, when it failed
 * @returns {Promise<Object>} Fake download object
 */
export async function makeFakeDownload({
  dir,
  suggestedFilename,
  body = 'hello',
  url = 'https://example.com/file',
  failure = null,
}) {
  const staged = path.join(
    dir,
    `staged-${Math.random().toString(36).slice(2)}`
  );
  if (!failure) {
    await fs.writeFile(staged, body);
  }

  return {
    url: () => url,
    suggestedFilename: () => suggestedFilename,
    failure: async () => failure,
    path: async () => staged,
    stagedPath: staged,
  };
}

/**
 * Expose an emitter the way an engine object does.
 *
 * @param {Object} emitter - Backing event emitter
 * @returns {{on: Function, off: Function}} Subscription methods
 */
function subscriptionsOf(emitter) {
  return {
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
  };
}

/**
 * Create a fake browser context that emits download events.
 *
 * @returns {Object} Context with `on`, `off` and `emitDownload`
 */
export function createFakeContext() {
  const emitter = new EventEmitter();
  return {
    ...subscriptionsOf(emitter),
    /**
     * Emit a download and wait for the manager to finish handling it.
     *
     * @param {Object} download - Fake download object
     * @returns {Promise<void>}
     */
    emitDownload: async (download) => {
      emitter.emit('download', download);
      // The manager's handler is async; yielding twice lets it run to the
      // point where the artifact is saved and published.
      await yieldToEngine();
      await yieldToEngine();
    },
  };
}

/**
 * Create a fake CDP session that speaks the Browser download domain.
 *
 * @returns {Object} Session with `send`, `on`, `off` and `emit`
 */
export function createFakeCdpSession() {
  const emitter = new EventEmitter();
  const sent = [];
  return {
    ...subscriptionsOf(emitter),
    sent,
    send: async (method, params) => {
      sent.push({ method, params });
    },
    emit: (event, payload) => emitter.emit(event, payload),
  };
}

/**
 * Give a suite its own download directory, created and removed per test.
 *
 * @returns {{path: string}} Holder whose `path` is the current directory
 */
export function useTempDownloadDirectory() {
  return useTempDirectory('bc-downloads-');
}
