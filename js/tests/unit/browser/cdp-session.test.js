import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  createCdpSession,
  wrapCdpSession,
} from '../../../src/browser/cdp-session.js';
import { makeBrowserCommander } from '../../../src/factory.js';
import * as publicApi from '../../../src/index.js';

function createEngineSession() {
  const calls = [];
  const listeners = [];
  return {
    calls,
    listeners,
    detachCount: 0,
    send(method, params) {
      calls.push({ method, params });
      return Promise.resolve({ echoed: method });
    },
    on(event, listener) {
      listeners.push(['on', event, listener]);
    },
    once(event, listener) {
      listeners.push(['once', event, listener]);
    },
    off(event, listener) {
      listeners.push(['off', event, listener]);
    },
    detach() {
      this.detachCount += 1;
      return Promise.resolve();
    },
  };
}

function createPlaywrightPage(session) {
  const context = {
    targets: [],
    newCDPSession(target) {
      context.targets.push(target);
      return Promise.resolve(session);
    },
  };
  const page = { context: () => context, locator: () => ({}) };
  return { page, context };
}

describe('createCdpSession', () => {
  it('opens a Playwright session through page.context().newCDPSession(page)', async () => {
    const session = createEngineSession();
    const { page, context } = createPlaywrightPage(session);

    const cdp = await createCdpSession(page, { engine: 'playwright' });

    assert.equal(cdp.engine, 'playwright');
    assert.equal(cdp.session, session);
    assert.deepEqual(context.targets, [page]);
  });

  it('opens a Puppeteer session through page.createCDPSession()', async () => {
    const session = createEngineSession();
    const page = { createCDPSession: () => Promise.resolve(session) };

    const cdp = await createCdpSession(page, { engine: 'puppeteer' });

    assert.equal(cdp.engine, 'puppeteer');
    assert.equal(cdp.session, session);
  });

  it('detects the engine from the page when it is not given', async () => {
    const session = createEngineSession();
    const { page } = createPlaywrightPage(session);

    assert.equal((await createCdpSession(page)).engine, 'playwright');
  });

  it('accepts the older {browser, page, engine} form', async () => {
    const session = createEngineSession();
    const page = { createCDPSession: () => Promise.resolve(session) };

    const cdp = await createCdpSession({
      browser: {},
      page,
      engine: 'puppeteer',
    });

    assert.equal(cdp.session, session);
  });

  it('requires a page', async () => {
    await assert.rejects(() => createCdpSession(undefined), /requires a page/u);
  });
});

describe('the uniform CDP session surface', () => {
  it('sends commands with empty params by default', async () => {
    const session = createEngineSession();
    const cdp = wrapCdpSession(session, 'puppeteer');

    assert.deepEqual(await cdp.send('Browser.getVersion'), {
      echoed: 'Browser.getVersion',
    });
    await cdp.send('Runtime.evaluate', { expression: '1' });
    assert.deepEqual(session.calls, [
      { method: 'Browser.getVersion', params: {} },
      { method: 'Runtime.evaluate', params: { expression: '1' } },
    ]);
  });

  it('forwards listeners and chains', () => {
    const session = createEngineSession();
    const cdp = wrapCdpSession(session, 'playwright');
    const listener = () => {};

    assert.equal(cdp.on('Network.requestWillBeSent', listener), cdp);
    assert.equal(cdp.once('Page.loadEventFired', listener), cdp);
    assert.equal(cdp.off('Network.requestWillBeSent', listener), cdp);
    assert.deepEqual(
      session.listeners.map(([kind, event]) => `${kind}:${event}`),
      [
        'on:Network.requestWillBeSent',
        'once:Page.loadEventFired',
        'off:Network.requestWillBeSent',
      ]
    );
  });

  it('detaches once', async () => {
    const session = createEngineSession();
    const cdp = wrapCdpSession(session, 'playwright');

    await cdp.detach();
    await cdp.detach();

    assert.equal(session.detachCount, 1);
  });
});

describe('public cdpSession entry points', () => {
  it('exports createCdpSession and wrapCdpSession', () => {
    assert.equal(publicApi.createCdpSession, createCdpSession);
    assert.equal(publicApi.wrapCdpSession, wrapCdpSession);
  });

  it('opens a session from a commander', async () => {
    const session = createEngineSession();
    const { page } = createPlaywrightPage(session);
    const commander = makeBrowserCommander({
      page,
      enableNetworkTracking: false,
      enableNavigationManager: false,
      enableDialogManager: false,
    });

    const cdp = await commander.createCdpSession();

    assert.equal(cdp.engine, 'playwright');
    assert.equal(cdp.session, session);
  });
});
