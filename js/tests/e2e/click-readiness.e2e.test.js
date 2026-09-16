/**
 * Real-browser tests for issue #89.
 *
 * The three repros in that issue are all about claims the library made
 * without checking: a page reported ready after the wait failed, a no-op
 * button reported as verified, and `noAutoScroll` scrolling the page anyway.
 * Only a real browser can disprove the last one, so these run against
 * Chromium and a local fixture server.
 *
 * Run with: npm run test:e2e:click-readiness
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

import { startFixtureServer } from '../helpers/readiness-server.js';

const VIEWPORT = { width: 800, height: 600 };

describe(
  'E2E - truthful readiness and click results (issue #89)',
  { skip: !process.env.RUN_E2E, timeout: 120000 },
  () => {
    let browser;
    let context;
    let page;
    let commander;
    let server;

    before(async () => {
      const { chromium } = await import('playwright');
      const { createCommander } = await import('../../src/index.js');

      server = await startFixtureServer();
      browser = await chromium.launch({
        headless: process.env.HEADLESS !== 'false',
      });
      context = await browser.newContext({ viewport: VIEWPORT });
      page = await context.newPage();
      commander = createCommander({ page, engine: 'playwright' });
    });

    after(async () => {
      await browser?.close();
      await server?.close();
    });

    /** Load a fixture page and reset the scroll position. */
    const open = async (path) => {
      await page.goto(`${server.baseUrl}${path}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.evaluate(() => window.scrollTo(0, 0));
    };

    const scrollY = () => page.evaluate(() => window.scrollY);
    const clicks = () => page.evaluate(() => window.__clicks);

    /**
     * Open a fixture page and click one of its elements.
     *
     * @param {string} path - Fixture page path
     * @param {string} selector - Element to click
     * @param {Object} options - Click options passed straight through
     * @returns {Promise<Object>} Click result
     */
    const clickOn = async (path, selector, options) => {
      await open(path);
      return commander.clickElement({
        locatorOrElement: page.locator(selector),
        ...options,
      });
    };

    /**
     * Wait for readiness and report how long the wait actually took.
     *
     * @param {Object} options - Options for `waitForReady`
     * @returns {Promise<{result: Object, elapsed: number}>} Outcome and duration
     */
    const timeReadiness = async (options) => {
      const started = Date.now();
      const result = await commander.waitForReady(options);
      return { result, elapsed: Date.now() - started };
    };

    describe("scroll: 'none'", () => {
      it('does not scroll the page when the target is already visible', async () => {
        await open('/far-below-fold');
        // Put the target on screen without the click doing it for us.
        await page.evaluate(() =>
          document.getElementById('target').scrollIntoView({ block: 'center' })
        );
        const before = await scrollY();

        const result = await commander.clickElement({
          locatorOrElement: page.locator('#target'),
          scroll: 'none',
          verify: false,
        });

        assert.strictEqual(result.dispatched, true, result.reason);
        assert.strictEqual(await clicks(), 1);
        assert.strictEqual(
          await scrollY(),
          before,
          'scroll: none must not move the page'
        );
      });

      it('fails clearly instead of scrolling to an off-screen target', async () => {
        // Regression test for issue #89 repro 3: this used to map to
        // Playwright's `force: true`, which skips actionability checks but
        // still scrolls, so the reported "no scroll" click scrolled to 3911.
        const result = await clickOn('/far-below-fold', '#target', {
          scroll: 'none',
          verify: false,
        });

        assert.strictEqual(result.status, 'failed');
        assert.strictEqual(result.dispatched, false);
        assert.match(result.reason, /viewport|obscure/i);
        assert.strictEqual(await scrollY(), 0, 'the page must not have moved');
        assert.strictEqual(await clicks(), 0);
      });

      it('treats the legacy noAutoScroll flag the same way', async () => {
        const result = await clickOn('/far-below-fold', '#target', {
          noAutoScroll: true,
          verify: false,
        });

        assert.strictEqual(result.dispatched, false);
        assert.strictEqual(await scrollY(), 0);
      });

      it("scroll: 'auto' still scrolls, as it always did", async () => {
        const result = await clickOn('/far-below-fold', '#target', {
          scroll: 'auto',
          verify: false,
        });

        assert.strictEqual(result.dispatched, true, result.reason);
        assert.ok((await scrollY()) > 0, 'scroll: auto is allowed to scroll');
        assert.strictEqual(await clicks(), 1);
      });

      it("scroll: 'preserve' restores the position it started from", async () => {
        await clickOn('/far-below-fold', '#target', {
          scroll: 'preserve',
          verify: false,
        });

        assert.strictEqual(await clicks(), 1);
        assert.strictEqual(await scrollY(), 0);
      });
    });

    describe('click verification', () => {
      it('reports unverified for a button that does nothing', async () => {
        // Regression test for issue #89 repro 2: "element still connected"
        // used to be reported as `verified: true`.
        const result = await clickOn('/no-op', '#noop', { verify: true });

        assert.strictEqual(await clicks(), 1, 'the click must still happen');
        assert.strictEqual(result.dispatched, true);
        assert.strictEqual(result.status, 'unverified');
        assert.strictEqual(result.effect, 'not-observed');
        assert.strictEqual(result.verified, false);
        assert.ok(result.evidence.length > 0, 'a verdict needs evidence');
      });

      it('confirms a click that actually changed the element', async () => {
        const result = await clickOn('/far-below-fold', '#target', {
          scroll: 'auto',
          verify: true,
        });

        assert.strictEqual(result.status, 'succeeded');
        assert.strictEqual(result.effect, 'confirmed');
        assert.strictEqual(result.verified, true);
      });

      it('carries an action id and an elapsed time on every result', async () => {
        const result = await clickOn('/no-op', '#noop', { verify: true });

        assert.strictEqual(typeof result.actionId, 'string');
        assert.ok(result.actionId.length > 0);
        assert.ok(Number.isFinite(result.elapsedMs));
      });

      it('does not claim a navigating click was verified by the navigation', async () => {
        const result = await clickOn('/navigates', '#go', { verify: true });

        await page.waitForSelector('#arrived');
        // The click did navigate, but nothing proved the click caused it, so
        // the result must not be dressed up as a confirmed effect.
        assert.notStrictEqual(result.effect, 'confirmed');
        assert.ok(
          ['unverified', 'interrupted', 'succeeded'].includes(result.status),
          `unexpected status ${result.status}`
        );
        assert.strictEqual(typeof result.actionId, 'string');
      });
    });

    describe('readiness deadlines', () => {
      it('reports timed_out instead of ready when the network never settles', async () => {
        // Regression test for issue #89 repro 1: the wait failed and the page
        // was announced as ready anyway.
        await open('/never-idle');

        const { result, elapsed } = await timeReadiness({
          timeout: 1500,
          reason: 'e2e deadline check',
        });

        assert.strictEqual(result.ready, false);
        assert.strictEqual(result.status, 'timed_out');
        assert.ok(
          elapsed < 6000,
          `the wait took ${elapsed}ms for a 1500ms budget`
        );
        assert.ok(result.evidence.length > 0);
      });

      it('never spends more than the budget it was given', async () => {
        await open('/never-idle');

        const { result, elapsed } = await timeReadiness({ timeout: 200 });

        assert.strictEqual(result.ready, false);
        assert.ok(
          elapsed < 3000,
          `a 200ms budget must not become ${elapsed}ms`
        );
      });
    });
  }
);
