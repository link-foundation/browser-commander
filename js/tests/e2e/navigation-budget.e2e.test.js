import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { CHROME_LAUNCH_OPTIONS } from '../helpers/e2e-browser.js';
import { createCommander, predicate } from '../../src/index.js';
import { sendHtml, startFixtureHost } from '../helpers/fixture-server.js';

// Authored local fixtures only. Each deliberately stalled connection is closed
// by server teardown; browser actions and suites have finite budgets.
for (const engine of ['playwright', 'puppeteer']) {
  describe(
    `navigation budgets: ${engine}`,
    { skip: !process.env.RUN_E2E, timeout: 60000 },
    () => {
      let browser;
      let page;
      let commander;
      let server;
      before(async () => {
        server = await startFixtureHost((route, _req, res) => {
          if (route === '/stall' || route === '/pending') {
            return;
          }
          if (route === '/redirect') {
            res.writeHead(302, { location: '/ready' });
            res.end();
            return;
          }
          if (route === '/continuous') {
            sendHtml(
              res,
              '<h1>Continuous requests</h1><script>setInterval(() => fetch("/pending"), 60);</script>'
            );
            return;
          }
          sendHtml(res, '<h1 id="ready">Ready</h1>');
        });
        const { chromium } = await import('playwright');
        const launchOptions = { headless: true, ...CHROME_LAUNCH_OPTIONS };
        if (engine === 'playwright') {
          browser = await chromium.launch(launchOptions);
          page = await browser.newPage();
        } else {
          const { default: puppeteer } = await import('puppeteer');
          browser = await puppeteer.launch({
            ...launchOptions,
            executablePath:
              CHROME_LAUNCH_OPTIONS.executablePath ?? chromium.executablePath(),
          });
          page = await browser.newPage();
        }
        commander = createCommander({ page, engine });
      });
      after(async () => {
        await commander?.destroy();
        await browser?.close();
        await server?.close();
      });
      const navigate = async (url, options = {}) => {
        const start = performance.now();
        const result = await commander.goto({
          url,
          timeout: 800,
          verify: false,
          waitForStableUrlBefore: false,
          waitForStableUrlAfter: false,
          waitForNetworkIdle: false,
          ...options,
        });
        assert.ok(
          performance.now() - start < 1600,
          'end-to-end budget must bound elapsed time'
        );
        return result;
      };
      it('loads a data page quickly with tracking enabled', async () => {
        assert.equal(
          (await navigate('data:text/html,<h1>Authored fixture</h1>')).status,
          'ready'
        );
        assert.ok(commander.networkTracker);
        assert.ok(page.listenerCount?.('request') > 0);
      });
      it('follows redirects under the same deadline', async () => {
        const result = await navigate(`${server.baseUrl}/redirect`);
        assert.equal(result.status, 'ready');
        assert.equal(page.url(), `${server.baseUrl}/ready`);
      });
      it('times out continuous network activity and cleans navigation state', async () => {
        const result = await navigate(`${server.baseUrl}/continuous`, {
          waitForNetworkIdle: true,
        });
        assert.equal(result.status, 'timed_out');
        assert.equal(commander.navigationManager.isNavigating(), false);
      });
      it('bounds a stalled engine navigation', async () => {
        assert.equal(
          (await navigate(`${server.baseUrl}/stall`)).status,
          'timed_out'
        );
      });
      it('observes a positive selector check', async () => {
        const ready = predicate({
          name: 'selector_ready',
          fn: async () =>
            page.evaluate(() => Boolean(document.querySelector('#ready'))),
        });
        assert.equal(
          (await navigate(`${server.baseUrl}/ready`, { checks: [ready] }))
            .status,
          'ready'
        );
      });
      it('cancels a stalled call and preserves only the session listeners', async () => {
        const abort = new AbortController();
        const event =
          engine === 'playwright' ? 'framenavigated' : 'framenavigated';
        const count = page.listenerCount?.(event);
        const timer = setTimeout(() => abort.abort(), 80);
        try {
          const result = await navigate(`${server.baseUrl}/stall`, {
            signal: abort.signal,
          });
          assert.equal(result.status, 'interrupted');
          assert.equal(commander.navigationManager.isNavigating(), false);
          assert.equal(page.listenerCount?.(event), count);
        } finally {
          clearTimeout(timer);
        }
      });
    }
  );
}
