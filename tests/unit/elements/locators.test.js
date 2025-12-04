import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  createPlaywrightLocator,
  getLocatorOrElement,
  waitForLocatorOrElement,
  waitForVisible,
  locator,
} from '../../../src/elements/locators.js';
import { createMockPlaywrightPage, createMockPuppeteerPage } from '../../helpers/mocks.js';

describe('locators', () => {
  describe('createPlaywrightLocator', () => {
    it('should throw when selector is not provided', () => {
      const page = createMockPlaywrightPage();
      assert.throws(
        () => createPlaywrightLocator({ page }),
        /selector is required/
      );
    });

    it('should create locator from simple selector', () => {
      const page = createMockPlaywrightPage();
      const loc = createPlaywrightLocator({ page, selector: 'button' });
      assert.ok(loc);
    });

    it('should handle :nth-of-type selector', () => {
      const page = createMockPlaywrightPage();
      const loc = createPlaywrightLocator({ page, selector: 'button:nth-of-type(2)' });
      assert.ok(loc);
    });

    it('should create locator for complex selector', () => {
      const page = createMockPlaywrightPage();
      const loc = createPlaywrightLocator({ page, selector: 'div.class > span[data-id="test"]' });
      assert.ok(loc);
    });
  });

  describe('getLocatorOrElement', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => getLocatorOrElement({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should return locator for Playwright', async () => {
      const page = createMockPlaywrightPage();
      const loc = await getLocatorOrElement({ page, engine: 'playwright', selector: 'button' });
      assert.ok(loc);
    });

    it('should return element for Puppeteer', async () => {
      const page = createMockPuppeteerPage();
      const el = await getLocatorOrElement({ page, engine: 'puppeteer', selector: 'button' });
      assert.ok(el);
    });

    it('should return existing locator/element unchanged', async () => {
      const page = createMockPlaywrightPage();
      const existingLocator = { isLocator: true };
      const result = await getLocatorOrElement({
        page,
        engine: 'playwright',
        selector: existingLocator,
      });
      assert.strictEqual(result, existingLocator);
    });

    it('should return null for Puppeteer when element not found', async () => {
      const page = createMockPuppeteerPage({ elements: { 'missing': { count: 0 } } });
      const el = await getLocatorOrElement({ page, engine: 'puppeteer', selector: 'missing' });
      assert.strictEqual(el, null);
    });
  });

  describe('waitForLocatorOrElement', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => waitForLocatorOrElement({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should wait for Playwright locator to be visible', async () => {
      const page = createMockPlaywrightPage({ elements: { 'button': { visible: true } } });
      const loc = await waitForLocatorOrElement({
        page,
        engine: 'playwright',
        selector: 'button',
        timeout: 1000,
      });
      assert.ok(loc);
    });

    it('should wait for Puppeteer element to be visible', async () => {
      const page = createMockPuppeteerPage({ elements: { 'button': { visible: true } } });
      const el = await waitForLocatorOrElement({
        page,
        engine: 'puppeteer',
        selector: 'button',
        timeout: 1000,
      });
      assert.ok(el);
    });

    it('should handle navigation errors with throwOnNavigation false', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        first: () => ({
          waitFor: async () => {
            throw new Error('Execution context was destroyed');
          },
        }),
      });

      const result = await waitForLocatorOrElement({
        page,
        engine: 'playwright',
        selector: 'button',
        throwOnNavigation: false,
      });
      assert.strictEqual(result, null);
    });
  });

  describe('waitForVisible', () => {
    it('should throw when locatorOrElement is not provided', async () => {
      await assert.rejects(
        () => waitForVisible({ engine: 'playwright' }),
        /locatorOrElement is required/
      );
    });

    it('should wait for Playwright locator visibility', async () => {
      const mockLocator = {
        waitFor: async () => {},
      };
      await waitForVisible({
        engine: 'playwright',
        locatorOrElement: mockLocator,
        timeout: 1000,
      });
      // Should not throw
    });

    it('should handle Puppeteer elements (no-op since already fetched)', async () => {
      const mockElement = { click: async () => {} };
      await waitForVisible({
        engine: 'puppeteer',
        locatorOrElement: mockElement,
        timeout: 1000,
      });
      // Should not throw
    });

    it('should throw for Puppeteer when element is null', async () => {
      await assert.rejects(
        () => waitForVisible({
          engine: 'puppeteer',
          locatorOrElement: null,
        }),
        /locatorOrElement is required/
      );
    });
  });

  describe('locator', () => {
    it('should throw when selector is not provided', () => {
      const page = createMockPlaywrightPage();
      assert.throws(
        () => locator({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should create Playwright locator', () => {
      const page = createMockPlaywrightPage();
      const loc = locator({ page, engine: 'playwright', selector: 'button' });
      assert.ok(loc);
    });

    it('should create Puppeteer locator wrapper', () => {
      const page = createMockPuppeteerPage();
      const loc = locator({ page, engine: 'puppeteer', selector: 'button' });
      assert.ok(loc);
      assert.ok(typeof loc.count === 'function');
      assert.ok(typeof loc.click === 'function');
      assert.ok(typeof loc.fill === 'function');
      assert.ok(typeof loc.textContent === 'function');
      assert.ok(typeof loc.nth === 'function');
      assert.ok(typeof loc.first === 'function');
      assert.ok(typeof loc.last === 'function');
    });

    it('should allow chained nth calls on Puppeteer wrapper', () => {
      const page = createMockPuppeteerPage();
      const loc = locator({ page, engine: 'puppeteer', selector: 'button' });
      const nthLoc = loc.nth(2);
      assert.ok(nthLoc);
      assert.ok(typeof nthLoc.click === 'function');
    });
  });
});
