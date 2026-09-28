/**
 * E2E tests for the selenium (WebDriver) engine (issue #104).
 *
 * launchWebDriver() starts chromedriver itself (found through driverPath,
 * PATH or Selenium Manager), so the suite needs only Chrome and the
 * selenium-webdriver dev dependency:
 *
 *   RUN_E2E=true CHROME_PATH=/usr/bin/google-chrome \
 *     xvfb-run -a node scripts/run-tests.mjs tests/e2e/webdriver.e2e.test.js
 *
 * The Firefox suite runs only when a firefox executable is on PATH (or
 * FIREFOX_PATH names one); geckodriver comes from PATH or Selenium Manager.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { accessSync, constants } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { launchWebDriver } from '../../src/browser/webdriver.js';
import { makeBrowserCommander } from '../../src/factory.js';
import { SANDBOX_ARGS } from '../helpers/e2e-browser.js';

const PAGE = `<!doctype html>
<title>WebDriver e2e</title>
<h1 data-testid="heading">Hello WebDriver</h1>
<input data-testid="name" value="">
<button data-testid="greet"
  onclick="document.querySelector('[data-testid=out]').textContent =
    'Hi ' + document.querySelector('[data-testid=name]').value;
    console.log('greeted', document.querySelector('[data-testid=name]').value)">
  Greet
</button>
<p data-testid="out"></p>`;

/** Serve PAGE on a loopback port; cookies need an http origin. */
async function startPageServer() {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** The firefox executable this machine has, or null. */
function findFirefox() {
  const candidates = process.env.FIREFOX_PATH
    ? [process.env.FIREFOX_PATH]
    : (process.env.PATH ?? '')
        .split(path.delimiter)
        .filter(Boolean)
        .map((directory) => path.join(directory, 'firefox'));
  return (
    candidates.find((candidate) => {
      try {
        accessSync(candidate, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

const headless = process.env.HEADLESS !== 'false';

describe(
  'E2E Tests - Selenium (WebDriver) engine',
  {
    skip: !process.env.RUN_E2E,
  },
  () => {
    let server;
    let session;
    let commander;

    before(async () => {
      server = await startPageServer();
      session = await launchWebDriver({
        browser: 'chrome',
        headless,
        bidi: true,
        args: SANDBOX_ARGS,
        ...(process.env.CHROME_PATH
          ? { executablePath: process.env.CHROME_PATH }
          : {}),
      });
      commander = makeBrowserCommander({ page: session.page });
    });

    after(async () => {
      await commander?.destroy?.();
      await session?.close();
      await server?.close();
    });

    it('detects the selenium engine', () => {
      assert.equal(commander.engine, 'selenium');
      assert.equal(session.bidi, true);
    });

    it('navigates', async () => {
      await commander.goto({ url: server.url });
      assert.equal(commander.getUrl(), server.url);
      assert.equal(await session.page.title(), 'WebDriver e2e');
    });

    it('finds elements and reads their text', async () => {
      assert.equal(await commander.count({ selector: 'input' }), 1);
      assert.equal(
        (
          await commander.textContent({ selector: '[data-testid="heading"]' })
        ).trim(),
        'Hello WebDriver'
      );
      assert.equal(
        await commander.isVisible({ selector: '[data-testid="greet"]' }),
        true
      );
    });

    it('types, clicks and receives the page console message over BiDi', async () => {
      const messages = [];
      const onConsole = (message) => messages.push(message.text());
      session.page.on('console', onConsole);
      await session.page.eventsReady();

      await commander.fill({ selector: '[data-testid="name"]', text: 'Ada' });
      assert.equal(
        await commander.inputValue({ selector: '[data-testid="name"]' }),
        'Ada'
      );
      await commander.click({ selector: '[data-testid="greet"]' });
      assert.equal(
        await commander.textContent({ selector: '[data-testid="out"]' }),
        'Hi Ada'
      );

      const deadline = Date.now() + 5000;
      while (
        !messages.some((text) => text.includes('greeted')) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      session.page.off('console', onConsole);
      assert.ok(
        messages.some((text) => text.includes('greeted Ada')),
        `console messages: ${JSON.stringify(messages)}`
      );
    });

    it('executes scripts with arguments', async () => {
      const product = await commander.evaluate({
        fn: (left, right) => `${left}x${right}`,
        args: ['6', '7'],
      });
      assert.equal(product, '6x7');
    });

    it('keeps navigator.webdriver false under chromedriver', async () => {
      assert.equal(
        await commander.evaluate({ fn: () => navigator.webdriver }),
        false
      );
    });

    it('takes a PNG screenshot', async () => {
      const png = await session.page.screenshot();
      assert.ok(Buffer.isBuffer(png));
      assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
    });

    it('sets, reads and deletes cookies', async () => {
      await session.page.setCookie({ name: 'e2e', value: 'webdriver' });
      const cookie = (await session.page.cookies()).find(
        (candidate) => candidate.name === 'e2e'
      );
      assert.equal(cookie?.value, 'webdriver');
      assert.equal(
        await commander.evaluate({ fn: () => document.cookie }),
        'e2e=webdriver'
      );
      await session.page.deleteCookie({ name: 'e2e' });
      assert.equal(
        (await session.page.cookies()).some((c) => c.name === 'e2e'),
        false
      );
    });

    it('prints the page to PDF', async () => {
      const pdf = await session.page.pdf({ format: 'A4' });
      assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
    });
  }
);

const firefox = findFirefox();

describe(
  'E2E Tests - Selenium (WebDriver) engine on Firefox',
  {
    skip: !process.env.RUN_E2E
      ? true
      : !firefox && 'firefox is not installed (set FIREFOX_PATH)',
  },
  () => {
    let server;
    let session;

    before(async () => {
      server = await startPageServer();
      session = await launchWebDriver({
        browser: 'firefox',
        executablePath: firefox,
        headless,
        bidi: true,
      });
    });

    after(async () => {
      await session?.close();
      await server?.close();
    });

    it('navigates, types and reads the result', async () => {
      const commander = makeBrowserCommander({ page: session.page });
      await commander.goto({ url: server.url });
      await commander.fill({ selector: '[data-testid="name"]', text: 'Grace' });
      await commander.click({ selector: '[data-testid="greet"]' });
      assert.equal(
        await commander.textContent({ selector: '[data-testid="out"]' }),
        'Hi Grace'
      );
      await commander.destroy?.();
    });
  }
);
