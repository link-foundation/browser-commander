import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  WebDriverPage,
  createWebDriverPage,
  isWebDriver,
} from '../../../src/core/webdriver-page.js';
import {
  SeleniumAdapter,
  createEngineAdapter,
} from '../../../src/core/engine-adapter.js';
import { detectEngine } from '../../../src/core/engine-detection.js';
import { isNavigationError } from '../../../src/core/navigation-safety.js';
import { WEBDRIVER_KEYS } from '../../../src/core/webdriver-conversions.js';
import { makeBrowserCommander } from '../../../src/factory.js';
import {
  createMockBidi,
  createMockDriver,
  createMockWebElement,
} from '../../helpers/webdriver-mocks.js';

const BIDI_CAPABILITIES = { webSocketUrl: 'ws://127.0.0.1:1/session/x' };

function bidiPage({ responses, unsupported, driverOptions } = {}) {
  const bidi = createMockBidi({ responses, unsupported });
  const driver = createMockDriver({
    capabilities: BIDI_CAPABILITIES,
    ...driverOptions,
  });
  const page = new WebDriverPage(driver, { connectBidi: async () => bidi });
  return { page, driver, bidi };
}

const lastActions = (driver) =>
  driver.calls.filter(([name]) => name === 'actions').at(-1)[1];

describe('WebDriverPage', () => {
  it('only wraps something shaped like a WebDriver', () => {
    assert.ok(isWebDriver(createMockDriver()));
    assert.ok(!isWebDriver({ $: () => {} }));
    assert.throws(() => new WebDriverPage({}), /needs a selenium-webdriver/);
  });

  it('knows its URL and context from the start', async () => {
    const driver = createMockDriver({ url: 'https://example.com/' });
    const page = await createWebDriverPage(driver);
    assert.equal(page.url(), 'https://example.com/');
    assert.equal(page.contextIdSync(), 'context-1');
    assert.equal(page.engine, 'selenium');
  });

  it('navigates with Get and applies a page-load timeout', async () => {
    const driver = createMockDriver();
    const page = new WebDriverPage(driver);
    assert.equal(
      await page.goto('https://example.com/a', { timeout: 5000 }),
      null
    );
    assert.deepEqual(driver.calls.slice(0, 2), [
      ['setTimeouts', { pageLoad: 5000 }],
      ['get', 'https://example.com/a'],
    ]);
    assert.equal(page.url(), 'https://example.com/a');
    await page.goBack();
    await page.goForward();
    await page.reload();
    assert.deepEqual(
      driver.calls.slice(2).map(([name]) => name),
      ['back', 'forward', 'refresh']
    );
  });

  it('evaluates functions with arguments and learns the URL', async () => {
    const driver = createMockDriver({
      url: 'https://example.com/b',
      script: (source, args) => args[0] * 2,
    });
    const page = new WebDriverPage(driver);
    assert.equal(await page.evaluate((x) => x * 2, 21), 42);
    const [, source, args] = driver.calls.at(-1);
    assert.match(source, /\(x\) => x \* 2/);
    assert.deepEqual(args, [21]);
    assert.equal(page.url(), 'https://example.com/b');
  });

  it('finds elements by CSS and evaluates on them', async () => {
    const element = createMockWebElement();
    const driver = createMockDriver({
      elements: { '#a': [element] },
      script: (source, args) => (args[0] === element ? 'text' : null),
    });
    const page = new WebDriverPage(driver);
    assert.equal(await page.$('#a'), element);
    assert.equal(await page.$('#missing'), null);
    assert.deepEqual(await page.$$('#a'), [element]);
    assert.equal(await page.$eval('#a', (el) => el.textContent), 'text');
    await assert.rejects(
      () => page.$eval('#missing', (el) => el),
      /failed to find element matching selector "#missing"/
    );
  });

  it('waits for a selector to become visible, or times out like Puppeteer', async () => {
    const element = createMockWebElement({ displayed: false });
    const driver = createMockDriver({ elements: { '#a': [element] } });
    const page = new WebDriverPage(driver);
    setTimeout(() => {
      element.displayed = true;
    }, 150);
    assert.equal(
      await page.waitForSelector('#a', { visible: true, timeout: 2000 }),
      element
    );
    assert.equal(await page.waitForSelector('#gone', { hidden: true }), null);
    await assert.rejects(
      () => page.waitForSelector('#never', { timeout: 150 }),
      (error) =>
        error.name === 'TimeoutError' && /150ms exceeded/.test(error.message)
    );
  });

  it('clicks with Element Click, and uses actions for other buttons and counts', async () => {
    const elements = {};
    const driver = createMockDriver({ elements });
    const element = createMockWebElement({}, driver.calls);
    elements['#b'] = [element];
    const page = new WebDriverPage(driver);
    await page.click('#b');
    assert.ok(driver.calls.some(([name]) => name === 'element.click'));
    await page.click('#b', { button: 'right', clickCount: 2 });
    assert.deepEqual(lastActions(driver), [
      ['move', { origin: element }],
      ['press', 2],
      ['release', 2],
      ['press', 2],
      ['release', 2],
    ]);
    await assert.rejects(() => page.click('#none'), /No element found/);
  });

  it('presses chords and types through input actions', async () => {
    const driver = createMockDriver();
    const page = new WebDriverPage(driver);
    await page.keyboard.press('Control+A');
    assert.deepEqual(lastActions(driver), [
      ['keyDown', WEBDRIVER_KEYS.Control],
      ['keyDown', 'A'],
      ['keyUp', 'A'],
      ['keyUp', WEBDRIVER_KEYS.Control],
    ]);
    await page.keyboard.type('hi');
    assert.deepEqual(lastActions(driver), [['sendKeys', 'hi']]);
    await page.keyboard.down('Shift');
    assert.deepEqual(lastActions(driver), [['keyDown', WEBDRIVER_KEYS.Shift]]);
  });

  it('moves, clicks and scrolls the mouse in viewport coordinates', async () => {
    const driver = createMockDriver();
    const page = new WebDriverPage(driver);
    await page.mouse.click(10.4, 20.6);
    assert.deepEqual(lastActions(driver), [
      ['move', { x: 10, y: 21, origin: 'viewport' }],
      ['press', 0],
      ['release', 0],
    ]);
    await page.mouse.wheel({ deltaY: 300 });
    assert.deepEqual(lastActions(driver), [
      ['scroll', 10, 21, 0, 300, 'viewport'],
    ]);
  });

  it('prints to PDF with Print Page and writes the file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'wd-pdf-'));
    try {
      const driver = createMockDriver();
      const page = new WebDriverPage(driver);
      const file = path.join(directory, 'out.pdf');
      const buffer = await page.pdf({ path: file, landscape: true });
      assert.equal(buffer.toString(), '%PDF-mock');
      assert.equal((await readFile(file)).toString(), '%PDF-mock');
      assert.deepEqual(driver.calls.at(-1), [
        'printPage',
        { orientation: 'landscape' },
      ]);
      await assert.rejects(
        () => page.pdf({ headerTemplate: '<b>x</b>' }),
        /webdriver-print-options/
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('takes viewport screenshots classically and full-page ones over BiDi', async () => {
    const { page, bidi } = bidiPage({
      responses: {
        'browsingContext.captureScreenshot': {
          data: Buffer.from('full').toString('base64'),
        },
      },
    });
    assert.equal((await page.screenshot()).toString(), 'png');
    assert.equal(
      await page.screenshot({ encoding: 'base64' }),
      Buffer.from('png').toString('base64')
    );
    const full = await page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 80,
    });
    assert.equal(full.toString(), 'full');
    assert.deepEqual(bidi.sent.at(-1).params, {
      context: 'context-1',
      origin: 'document',
      format: { type: 'image/jpeg', quality: 0.8 },
    });
    await page.screenshot({ clip: { x: 1, y: 2, width: 3, height: 4 } });
    assert.deepEqual(bidi.sent.at(-1).params.clip, {
      type: 'box',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });

  it('explains that full-page screenshots need BiDi on a classic session', async () => {
    const page = new WebDriverPage(createMockDriver());
    assert.equal(await page.bidi(), null);
    await assert.rejects(
      () => page.screenshot({ fullPage: true }),
      /needs WebDriver BiDi; launch with bidi: true.*webdriver-classic-has-no-events/
    );
  });

  it('reads, adds and deletes cookies in the Puppeteer shape', async () => {
    const driver = createMockDriver({
      cookies: [{ name: 'a', value: '1', domain: 'example.com' }],
    });
    const page = new WebDriverPage(driver);
    assert.equal((await page.cookies())[0].expires, -1);
    await page.setCookie({ name: 'b', value: '2', expires: 1900000000 });
    assert.deepEqual(driver.calls.at(-1), [
      'addCookie',
      { name: 'b', value: '2', expiry: 1900000000 },
    ]);
    await page.deleteCookie({ name: 'a' });
    assert.deepEqual(
      (await page.cookies()).map((cookie) => cookie.name),
      ['b']
    );
  });

  it('adds and removes preload scripts over BiDi', async () => {
    const { page, bidi } = bidiPage({
      responses: { 'script.addPreloadScript': { script: 'preload-1' } },
    });
    const { identifier } = await page.evaluateOnNewDocument((value) => {
      window.flag = value;
    }, 'on');
    assert.equal(identifier, 'preload-1');
    const { params } = bidi.sent.at(-1);
    assert.deepEqual(params.contexts, ['context-1']);
    assert.match(params.functionDeclaration, /\(\.\.\.\["on"\]\)/);
    await page.removeScriptToEvaluateOnNewDocument(identifier);
    assert.deepEqual(bidi.sent.at(-1), {
      method: 'script.removePreloadScript',
      params: { script: 'preload-1' },
    });
  });

  it('turns BiDi error responses into errors', async () => {
    const { page } = bidiPage({
      responses: {
        'browsingContext.navigate': {
          error: 'unknown error',
          message: 'net::ERR_NAME_NOT_RESOLVED',
        },
      },
    });
    await assert.rejects(
      () => page.navigateBidi('https://nowhere.invalid/'),
      /browsingContext.navigate: unknown error: net::ERR_NAME_NOT_RESOLVED/
    );
  });

  it('closes its window and reports itself closed', async () => {
    const driver = createMockDriver();
    const page = new WebDriverPage(driver);
    let closed = false;
    page.on('close', () => {
      closed = true;
    });
    await page.close();
    assert.ok(page.isClosed());
    assert.ok(closed);
    assert.ok(page.mainFrame().isDetached());
  });
});

describe('WebDriver BiDi event bridge', () => {
  it('re-emits console entries of its own context as console messages', async () => {
    const { page, bidi } = bidiPage();
    const messages = [];
    page.on('console', (message) => messages.push(message.text()));
    await page.eventsReady();
    bidi.fire('log.entryAdded', {
      type: 'console',
      method: 'log',
      text: 'hello',
      source: { context: 'context-1' },
    });
    bidi.fire('log.entryAdded', {
      type: 'console',
      text: 'other tab',
      source: { context: 'context-2' },
    });
    assert.deepEqual(messages, ['hello']);
  });

  it('re-emits javascript log entries as page errors', async () => {
    const { page, bidi } = bidiPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.eventsReady();
    bidi.fire('log.entryAdded', {
      type: 'javascript',
      text: 'Error: boom',
      source: { context: 'context-1' },
    });
    assert.deepEqual(errors, ['Error: boom']);
  });

  it('tracks navigations and falls back to domContentLoaded on older drivers', async () => {
    const { page, bidi } = bidiPage({
      unsupported: ['browsingContext.navigationCommitted'],
    });
    const urls = [];
    page.once('framenavigated', (frame) => urls.push(frame.url()));
    await page.eventsReady();
    assert.ok(bidi.callbacks.has('browsingContext.domContentLoaded'));
    assert.ok(bidi.callbacks.has('browsingContext.fragmentNavigated'));
    bidi.fire('browsingContext.domContentLoaded', {
      context: 'context-1',
      url: 'https://example.com/next',
    });
    assert.deepEqual(urls, ['https://example.com/next']);
    assert.equal(page.url(), 'https://example.com/next');
  });

  it('turns user prompts into dialogs that answer over BiDi', async () => {
    const { page, bidi } = bidiPage();
    page.on('dialog', (dialog) => dialog.accept('yes'));
    await page.eventsReady();
    bidi.fire('browsingContext.userPromptOpened', {
      context: 'context-1',
      type: 'prompt',
      message: 'Sure?',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(bidi.sent.at(-1), {
      method: 'browsingContext.handleUserPrompt',
      params: { context: 'context-1', accept: true, userText: 'yes' },
    });
  });

  it('re-emits network events as requests and responses', async () => {
    const { page, bidi } = bidiPage();
    const seen = [];
    page.on('request', (request) => seen.push(['request', request.url()]));
    page.on('response', (response) =>
      seen.push(['response', response.status()])
    );
    await page.eventsReady();
    const request = {
      request: 'r',
      url: 'https://example.com/',
      method: 'GET',
    };
    bidi.fire('network.beforeRequestSent', { request });
    bidi.fire('network.responseCompleted', {
      request,
      response: { status: 200 },
    });
    assert.deepEqual(seen, [
      ['request', 'https://example.com/'],
      ['response', 200],
    ]);
  });

  it('stays silent on a classic session and unsubscribes on dispose', async () => {
    const classic = new WebDriverPage(createMockDriver());
    classic.on('console', () => {});
    await classic.eventsReady();

    const { page, bidi } = bidiPage();
    page.on('console', () => {});
    page.on('pageerror', () => {});
    await page.eventsReady();
    assert.equal(bidi.callbacks.size, 1);
    await page.dispose();
    assert.deepEqual(bidi.unsubscribed, ['log.entryAdded']);
  });
});

describe('SeleniumAdapter', () => {
  it('is chosen for the selenium engine', () => {
    const page = new WebDriverPage(createMockDriver());
    const adapter = createEngineAdapter(page, 'selenium');
    assert.ok(adapter instanceof SeleniumAdapter);
    assert.equal(adapter.getEngineName(), 'selenium');
    assert.equal(adapter.getDriver(), page.driver);
  });

  it('clicks, types and fills with native element commands', async () => {
    const driver = createMockDriver();
    const adapter = new SeleniumAdapter(new WebDriverPage(driver));
    const element = createMockWebElement({}, driver.calls);
    await adapter.click(element);
    await adapter.type(element, 'abc');
    await adapter.fill(element, 'xyz');
    assert.deepEqual(
      driver.calls.filter(([name]) => name.startsWith('element.')),
      [
        ['element.click', 'el'],
        ['element.sendKeys', 'el', 'abc'],
        ['element.clear', 'el'],
        ['element.sendKeys', 'el', 'xyz'],
      ]
    );
  });

  it('force-clicks with a pointer action at the element', async () => {
    const driver = createMockDriver();
    const adapter = new SeleniumAdapter(new WebDriverPage(driver));
    const element = createMockWebElement({}, driver.calls);
    await adapter.click(element, { force: true });
    assert.deepEqual(lastActions(driver), [
      ['move', { origin: element }],
      ['click'],
    ]);
  });

  it('delivers console messages and navigations through BiDi helpers', async () => {
    const { page, bidi } = bidiPage({
      responses: {
        'browsingContext.navigate': {
          navigation: 'n1',
          url: 'https://a.test/',
        },
      },
    });
    const adapter = new SeleniumAdapter(page);
    const texts = [];
    const urls = [];
    const stopConsole = await adapter.onConsoleMessage((message) =>
      texts.push(message.text())
    );
    await adapter.onNavigation((url) => urls.push(url));
    bidi.fire('log.entryAdded', { type: 'console', text: 'one' });
    stopConsole();
    bidi.fire('log.entryAdded', { type: 'console', text: 'two' });
    bidi.fire('browsingContext.navigationCommitted', {
      context: 'context-1',
      url: 'https://a.test/',
    });
    assert.deepEqual(texts, ['one']);
    assert.deepEqual(urls, ['https://a.test/']);

    const result = await adapter.navigate('https://a.test/', { wait: 'none' });
    assert.equal(result.navigation, 'n1');
    assert.deepEqual(bidi.sent.at(-1).params, {
      context: 'context-1',
      url: 'https://a.test/',
      wait: 'none',
    });
  });

  it('refuses BiDi helpers on a classic session with a clear error', async () => {
    const adapter = new SeleniumAdapter(new WebDriverPage(createMockDriver()));
    await assert.rejects(
      () => adapter.onConsoleMessage(() => {}),
      /needs WebDriver BiDi/
    );
  });
});

describe('selenium engine detection and the commander', () => {
  it('detects a raw WebDriver and the facade as selenium', () => {
    const driver = createMockDriver();
    assert.equal(detectEngine(driver), 'selenium');
    assert.equal(detectEngine(new WebDriverPage(driver)), 'selenium');
  });

  it('wraps a raw WebDriver in the facade', () => {
    const driver = createMockDriver();
    const commander = makeBrowserCommander({
      page: driver,
      enableNetworkTracking: false,
      enableNavigationManager: false,
    });
    assert.equal(commander.engine, 'selenium');
    assert.ok(commander.page instanceof WebDriverPage);
    assert.equal(commander.page.driver, driver);
  });

  it('keeps a facade it was given', () => {
    const page = new WebDriverPage(createMockDriver());
    const commander = makeBrowserCommander({
      page,
      enableNetworkTracking: false,
      enableNavigationManager: false,
    });
    assert.equal(commander.page, page);
  });

  it('treats stale elements and closed windows as navigation errors', () => {
    assert.ok(
      isNavigationError(
        new Error('stale element reference: stale element not found')
      )
    );
    assert.ok(
      isNavigationError(
        new Error('no such window: target window already closed')
      )
    );
  });
});
