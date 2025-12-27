import { describe, it } from 'node:test';
import assert from 'node:assert';
import { makeBrowserCommander } from '../../src/factory.js';
import {
  createMockPlaywrightPage,
  createMockPuppeteerPage,
  createMockLogger,
} from '../helpers/mocks.js';

describe('factory', () => {
  describe('makeBrowserCommander', () => {
    it('should throw when page is not provided', () => {
      assert.throws(() => makeBrowserCommander({}), /page is required/);
    });

    it('should create commander with Playwright page', () => {
      const page = createMockPlaywrightPage();
      page.locator = (sel) => ({
        count: async () => 1,
        waitFor: async () => {},
      });
      page.context = () => ({});

      const commander = makeBrowserCommander({ page });

      assert.ok(commander);
      assert.ok(typeof commander.clickButton === 'function');
      assert.ok(typeof commander.fillTextArea === 'function');
      assert.ok(typeof commander.goto === 'function');
      assert.ok(typeof commander.wait === 'function');
    });

    it('should create commander with Puppeteer page', () => {
      const page = createMockPuppeteerPage();
      // Make sure it doesn't have Playwright-specific methods
      delete page.locator;
      delete page.context;
      page.$eval = async () => {};

      const commander = makeBrowserCommander({ page });

      assert.ok(commander);
      assert.ok(typeof commander.clickButton === 'function');
    });

    it('should accept verbose option', () => {
      const page = createMockPlaywrightPage();
      page.locator = (sel) => ({
        count: async () => 1,
        waitFor: async () => {},
      });
      page.context = () => ({});

      const commander = makeBrowserCommander({ page, verbose: true });

      assert.ok(commander);
    });

    it('should have all expected methods', () => {
      const page = createMockPlaywrightPage();
      page.locator = (sel) => ({
        count: async () => 1,
        waitFor: async () => {},
      });
      page.context = () => ({});

      const commander = makeBrowserCommander({ page });

      // Core navigation
      assert.ok(typeof commander.goto === 'function');
      assert.ok(typeof commander.getUrl === 'function');

      // Element selection
      assert.ok(typeof commander.querySelector === 'function');
      assert.ok(typeof commander.querySelectorAll === 'function');
      assert.ok(typeof commander.findByText === 'function');

      // Interactions
      assert.ok(typeof commander.clickButton === 'function');
      assert.ok(typeof commander.fillTextArea === 'function');

      // Element state
      assert.ok(typeof commander.isVisible === 'function');
      assert.ok(typeof commander.isEnabled === 'function');
      assert.ok(typeof commander.count === 'function');

      // Content
      assert.ok(typeof commander.textContent === 'function');
      assert.ok(typeof commander.inputValue === 'function');
      assert.ok(typeof commander.getAttribute === 'function');

      // Utilities
      assert.ok(typeof commander.wait === 'function');
      assert.ok(typeof commander.evaluate === 'function');
    });

    it('should return engine type', () => {
      const page = createMockPlaywrightPage();
      page.locator = (sel) => ({
        count: async () => 1,
        waitFor: async () => {},
      });
      page.context = () => ({});

      const commander = makeBrowserCommander({ page });

      assert.ok(
        commander.engine === 'playwright' || commander.engine === 'puppeteer'
      );
    });

    it('should expose page object', () => {
      const page = createMockPlaywrightPage();
      page.locator = (sel) => ({
        count: async () => 1,
        waitFor: async () => {},
      });
      page.context = () => ({});

      const commander = makeBrowserCommander({ page });

      assert.strictEqual(commander.page, page);
    });

    it('should allow disabling network tracking', () => {
      const page = createMockPlaywrightPage();
      page.locator = (sel) => ({
        count: async () => 1,
        waitFor: async () => {},
      });
      page.context = () => ({});

      const commander = makeBrowserCommander({
        page,
        enableNetworkTracking: false,
      });

      assert.ok(commander);
      assert.strictEqual(commander.networkTracker, null);
    });

    it('should allow disabling navigation manager', () => {
      const page = createMockPlaywrightPage();
      page.locator = (sel) => ({
        count: async () => 1,
        waitFor: async () => {},
      });
      page.context = () => ({});

      const commander = makeBrowserCommander({
        page,
        enableNavigationManager: false,
      });

      assert.ok(commander);
      assert.strictEqual(commander.navigationManager, null);
    });

    it('should have destroy method', async () => {
      const page = createMockPlaywrightPage();
      page.locator = (sel) => ({
        count: async () => 1,
        waitFor: async () => {},
      });
      page.context = () => ({});

      const commander = makeBrowserCommander({ page });

      assert.ok(typeof commander.destroy === 'function');
      // Should not throw
      await commander.destroy();
    });
  });
});
