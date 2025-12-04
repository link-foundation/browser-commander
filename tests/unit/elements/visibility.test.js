import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isVisible, isEnabled, count } from '../../../src/elements/visibility.js';
import { createMockPlaywrightPage, createMockPuppeteerPage } from '../../helpers/mocks.js';

describe('visibility', () => {
  describe('isVisible', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => isVisible({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should return true for visible element with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'button': { visible: true, count: 1 } },
      });
      const visible = await isVisible({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(visible, true);
    });

    it('should return false for non-visible element with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'button': { visible: false, count: 1 } },
      });
      const visible = await isVisible({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(visible, false);
    });

    it('should return true for visible element with Puppeteer', async () => {
      const page = createMockPuppeteerPage({
        elements: { 'button': { visible: true, count: 1 } },
      });
      const visible = await isVisible({
        page,
        engine: 'puppeteer',
        selector: 'button',
      });
      assert.strictEqual(visible, true);
    });

    it('should return false when element not found with Puppeteer', async () => {
      const page = createMockPuppeteerPage({
        elements: { 'button': { count: 0 } },
      });
      const visible = await isVisible({
        page,
        engine: 'puppeteer',
        selector: 'button',
      });
      assert.strictEqual(visible, false);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        waitFor: async () => {
          throw new Error('Execution context was destroyed');
        },
      });
      const visible = await isVisible({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(visible, false);
    });
  });

  describe('isEnabled', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => isEnabled({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should return true for enabled element with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'button': { enabled: true, count: 1 } },
      });
      const enabled = await isEnabled({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(enabled, true);
    });

    it('should return false for disabled element with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'button': { enabled: false, disabled: true, count: 1 } },
      });
      const enabled = await isEnabled({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(enabled, false);
    });

    it('should check for custom disabled classes', async () => {
      const page = createMockPlaywrightPage({
        elements: {
          'button': {
            enabled: true,
            className: 'magritte-button_loading',
            count: 1,
          },
        },
      });
      const enabled = await isEnabled({
        page,
        engine: 'playwright',
        selector: 'button',
        disabledClasses: ['magritte-button_loading'],
      });
      assert.strictEqual(enabled, false);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        first: () => ({
          evaluate: async () => {
            throw new Error('Execution context was destroyed');
          },
        }),
      });
      const enabled = await isEnabled({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(enabled, false);
    });
  });

  describe('count', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => count({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should return element count with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'button': { count: 5 } },
      });
      const c = await count({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(c, 5);
    });

    it('should return element count with Puppeteer', async () => {
      const page = createMockPuppeteerPage({
        elements: { 'button': { count: 3 } },
      });
      const c = await count({
        page,
        engine: 'puppeteer',
        selector: 'button',
      });
      assert.strictEqual(c, 3);
    });

    it('should return 0 when no elements found', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'button': { count: 0 } },
      });
      const c = await count({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(c, 0);
    });

    it('should handle Puppeteer text selector objects', async () => {
      const page = createMockPuppeteerPage();
      page.evaluate = async () => 2; // Mock count result

      const c = await count({
        page,
        engine: 'puppeteer',
        selector: {
          _isPuppeteerTextSelector: true,
          baseSelector: 'button',
          text: 'Submit',
          exact: false,
        },
      });
      assert.strictEqual(c, 2);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        count: async () => {
          throw new Error('Execution context was destroyed');
        },
      });
      const c = await count({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(c, 0);
    });
  });
});
