import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';

import {
  loadStorageState,
  restorePlaywrightStorageState,
  restorePuppeteerStorageState,
  saveStorageState,
} from '../../../src/browser/storage-state.js';
import { saveStorageState as publicSaveStorageState } from '../../../src/index.js';

describe('browser storage state', () => {
  let temporaryDirectory;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = undefined;
    }
  });

  it('loads storage state from a path and accepts an object unchanged', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-storage-state-')
    );
    const filePath = path.join(temporaryDirectory, 'state.json');
    const state = {
      cookies: [{ name: 'session', value: 'saved', domain: '.example.com' }],
      origins: [],
    };
    await writeFile(filePath, JSON.stringify(state));

    assert.deepEqual(await loadStorageState(filePath), state);
    assert.equal(await loadStorageState(state), state);
  });

  it('rejects invalid storage state input', async () => {
    await assert.rejects(
      () => loadStorageState(null),
      /storageState must be a file path or an object/
    );
  });

  it('exports saveStorageState from the package API', () => {
    assert.equal(publicSaveStorageState, saveStorageState);
  });

  it('restores Puppeteer cookies and localStorage before navigation', async () => {
    const calls = [];
    const state = {
      cookies: [{ name: 'session', value: 'saved', domain: '.example.com' }],
      origins: [
        {
          origin: 'https://example.com',
          localStorage: [{ name: 'theme', value: 'dark' }],
        },
      ],
    };
    const page = {
      setCookie: async (...cookies) => calls.push(['cookies', cookies]),
      evaluateOnNewDocument: async (fn, value) =>
        calls.push(['new-document', fn, value]),
      evaluate: async (fn, value) => calls.push(['current-page', fn, value]),
    };

    await restorePuppeteerStorageState({ page, storageState: state });

    assert.deepEqual(calls[0], ['cookies', state.cookies]);
    assert.equal(calls[1][0], 'new-document');
    assert.equal(calls[1][2], state.origins);
    assert.equal(calls[2][0], 'current-page');
    assert.equal(calls[2][2], state.origins);
  });

  it('restores Playwright cookies and localStorage before navigation', async () => {
    const calls = [];
    const state = {
      cookies: [{ name: 'session', value: 'saved', domain: '.example.com' }],
      origins: [
        {
          origin: 'https://example.com',
          localStorage: [{ name: 'theme', value: 'dark' }],
        },
      ],
    };
    const page = {
      evaluate: async (fn, value) => calls.push(['current-page', fn, value]),
    };
    const context = {
      addCookies: async (cookies) => calls.push(['cookies', cookies]),
      addInitScript: async (fn, value) =>
        calls.push(['new-document', fn, value]),
      pages: () => [page],
    };

    await restorePlaywrightStorageState({ context, storageState: state });

    assert.deepEqual(calls[0], ['cookies', state.cookies]);
    assert.equal(calls[1][0], 'new-document');
    assert.equal(calls[1][2], state.origins);
    assert.equal(calls[2][0], 'current-page');
    assert.equal(calls[2][2], state.origins);
  });

  it('delegates Playwright saves to the page context', async () => {
    const savedState = { cookies: [], origins: [] };
    const calls = [];
    const page = {
      context: () => ({
        storageState: async (options) => {
          calls.push(options);
          return savedState;
        },
      }),
    };

    assert.equal(await saveStorageState(page, '/tmp/state.json'), savedState);
    assert.deepEqual(calls, [{ path: '/tmp/state.json' }]);
  });

  it('saves Puppeteer cookies and current-origin localStorage', async () => {
    temporaryDirectory = await mkdtemp(
      path.join(os.tmpdir(), 'browser-commander-storage-state-')
    );
    const filePath = path.join(temporaryDirectory, 'state.json');
    const cookies = [
      { name: 'session', value: 'saved', domain: '.example.com' },
    ];
    const localStorage = [{ name: 'theme', value: 'dark' }];
    const page = {
      browserContext: () => ({}),
      cookies: async () => cookies,
      url: () => 'https://example.com/inbox',
      evaluate: async () => localStorage,
    };

    const state = await saveStorageState(page, filePath);

    assert.deepEqual(state, {
      cookies,
      origins: [{ origin: 'https://example.com', localStorage }],
    });
    assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')), state);
  });
});
