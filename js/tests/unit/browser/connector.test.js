import assert from 'node:assert';
import { describe, it } from 'node:test';

import {
  connectBrowser,
  pickForegroundPage,
  connectBrowserWithDependencies,
} from '../../../src/browser/connector.js';
import { connectBrowser as publicConnectBrowser } from '../../../src/index.js';

describe('connectBrowser', () => {
  it('is exported from the package API', () => {
    assert.equal(publicConnectBrowser, connectBrowser);
  });

  it('attaches Playwright over an HTTP CDP endpoint and reuses its first page', async () => {
    const calls = [];
    const page = { id: 'playwright-page' };
    const context = {
      pages: () => [page],
      addCookies: async (cookies) => calls.push(['cookies', cookies]),
    };
    const browser = { contexts: () => [context] };
    const chromium = {
      connectOverCDP: async (endpoint, options) => {
        calls.push(['connect', endpoint, options]);
        return browser;
      },
    };
    const seedCookies = [
      { name: 'SID', value: 'saved', domain: '.example.com', path: '/' },
    ];

    const result = await connectBrowserWithDependencies(
      {
        engine: 'playwright',
        cdpEndpoint: 'http://127.0.0.1:9222',
        slowMo: 25,
        timeout: 5_000,
        seedCookies,
      },
      { loadPlaywright: async () => ({ chromium }) }
    );

    assert.equal(result.browser, browser);
    assert.equal(result.page, page);
    assert.deepEqual(calls, [
      ['connect', 'http://127.0.0.1:9222', { slowMo: 25, timeout: 5_000 }],
      ['cookies', seedCookies],
    ]);
  });

  it('maps a WebSocket endpoint to Puppeteer and creates a page when needed', async () => {
    const calls = [];
    const page = {
      id: 'new-puppeteer-page',
      setCookie: async (...cookies) => calls.push(['cookies', cookies]),
    };
    const browser = {
      pages: async () => [],
      newPage: async () => {
        calls.push(['newPage']);
        return page;
      },
    };
    const puppeteer = {
      connect: async (options) => {
        calls.push(['connect', options]);
        return browser;
      },
    };
    const seedCookies = [
      { name: 'session', value: 'saved', domain: '.example.com', path: '/' },
    ];

    const result = await connectBrowserWithDependencies(
      {
        engine: 'puppeteer',
        wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/id',
        slowMo: 10,
        protocolTimeout: 30_000,
        seedCookies,
      },
      { loadPuppeteer: async () => ({ default: puppeteer }) }
    );

    assert.equal(result.browser, browser);
    assert.equal(result.page, page);
    assert.deepEqual(calls, [
      [
        'connect',
        {
          browserWSEndpoint: 'ws://127.0.0.1:9222/devtools/browser/id',
          defaultViewport: null,
          slowMo: 10,
          protocolTimeout: 30_000,
        },
      ],
      ['newPage'],
      ['cookies', seedCookies],
    ]);
  });

  it('requires exactly one endpoint and a supported engine', async () => {
    await assert.rejects(
      () => connectBrowserWithDependencies({ engine: 'playwright' }, {}),
      /exactly one of cdpEndpoint or wsEndpoint/
    );
    await assert.rejects(
      () =>
        connectBrowserWithDependencies(
          {
            engine: 'playwright',
            cdpEndpoint: 'http://127.0.0.1:9222',
            wsEndpoint: 'ws://127.0.0.1:9222/devtools/browser/id',
          },
          {}
        ),
      /exactly one of cdpEndpoint or wsEndpoint/
    );
    await assert.rejects(
      () =>
        connectBrowserWithDependencies(
          { engine: 'invalid', cdpEndpoint: 'http://127.0.0.1:9222' },
          {}
        ),
      /Invalid engine: invalid/
    );
  });
});

describe('pickForegroundPage', () => {
  const page = (id, state) => ({ id, evaluate: async () => state });

  it('prefers the visible tab over the first one', async () => {
    const picked = await pickForegroundPage([
      page('ntp', 'hidden'),
      page('whats-new', 'visible'),
    ]);
    assert.equal(picked.id, 'whats-new');
  });

  it('falls back to the first tab when none reports visible', async () => {
    const failing = {
      id: 'crashed',
      evaluate: async () => Promise.reject(new Error('gone')),
    };
    const picked = await pickForegroundPage([failing, page('b', 'hidden')]);
    assert.equal(picked.id, 'crashed');
    assert.equal(await pickForegroundPage([]), undefined);
  });
});
