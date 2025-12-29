import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  querySelector,
  querySelectorAll,
  findByText,
  normalizeSelector,
  withTextSelectorSupport,
  waitForSelector,
} from '../../../src/elements/selectors.js';
import {
  createMockPlaywrightPage,
  createMockPuppeteerPage,
} from '../../helpers/mocks.js';

describe('selectors', () => {
  describe('querySelector', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => querySelector({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should find element with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { button: { count: 1 } },
      });
      const el = await querySelector({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.ok(el);
    });

    it('should find element with Puppeteer', async () => {
      const page = createMockPuppeteerPage({
        elements: { button: { count: 1 } },
      });
      const el = await querySelector({
        page,
        engine: 'puppeteer',
        selector: 'button',
      });
      assert.ok(el);
    });

    it('should return null when element not found with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { button: { count: 0 } },
      });
      const el = await querySelector({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(el, null);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        first: () => ({
          count: async () => {
            throw new Error('Execution context was destroyed');
          },
        }),
      });
      const el = await querySelector({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.strictEqual(el, null);
    });
  });

  describe('querySelectorAll', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => querySelectorAll({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should find all elements with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { button: { count: 3 } },
      });
      const elements = await querySelectorAll({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.ok(Array.isArray(elements));
      assert.strictEqual(elements.length, 3);
    });

    it('should find all elements with Puppeteer', async () => {
      const page = createMockPuppeteerPage({
        elements: { button: { count: 3 } },
      });
      const elements = await querySelectorAll({
        page,
        engine: 'puppeteer',
        selector: 'button',
      });
      assert.ok(Array.isArray(elements));
      assert.strictEqual(elements.length, 3);
    });

    it('should return empty array when no elements found', async () => {
      const page = createMockPlaywrightPage({
        elements: { button: { count: 0 } },
      });
      const elements = await querySelectorAll({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.ok(Array.isArray(elements));
      assert.strictEqual(elements.length, 0);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        count: async () => {
          throw new Error('Execution context was destroyed');
        },
      });
      const elements = await querySelectorAll({
        page,
        engine: 'playwright',
        selector: 'button',
      });
      assert.ok(Array.isArray(elements));
      assert.strictEqual(elements.length, 0);
    });
  });

  describe('findByText', () => {
    it('should throw when text is not provided', async () => {
      await assert.rejects(
        () => findByText({ engine: 'playwright' }),
        /text is required/
      );
    });

    it('should return Playwright text selector', async () => {
      const selector = await findByText({
        engine: 'playwright',
        text: 'Click me',
        selector: 'button',
      });
      assert.ok(selector.includes('has-text'));
      assert.ok(selector.includes('Click me'));
    });

    it('should return Playwright exact text selector', async () => {
      const selector = await findByText({
        engine: 'playwright',
        text: 'Click me',
        selector: 'button',
        exact: true,
      });
      assert.ok(selector.includes('text-is'));
      assert.ok(selector.includes('Click me'));
    });

    it('should return Puppeteer text selector object', async () => {
      const selector = await findByText({
        engine: 'puppeteer',
        text: 'Click me',
        selector: 'button',
      });
      assert.ok(typeof selector === 'object');
      assert.strictEqual(selector._isPuppeteerTextSelector, true);
      assert.strictEqual(selector.text, 'Click me');
      assert.strictEqual(selector.baseSelector, 'button');
    });

    it('should use default selector when not provided', async () => {
      const selector = await findByText({
        engine: 'playwright',
        text: 'Hello',
      });
      assert.ok(selector.includes('*'));
    });
  });

  describe('normalizeSelector', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => normalizeSelector({ page }),
        /selector is required/
      );
    });

    it('should return string selector unchanged', async () => {
      const page = createMockPlaywrightPage();
      const result = await normalizeSelector({ page, selector: 'button' });
      assert.strictEqual(result, 'button');
    });

    it('should return non-text-selector object unchanged', async () => {
      const page = createMockPlaywrightPage();
      const obj = { someKey: 'value' };
      const result = await normalizeSelector({ page, selector: obj });
      assert.strictEqual(result, obj);
    });
  });

  describe('withTextSelectorSupport', () => {
    it('should wrap function and pass through options', async () => {
      const page = createMockPuppeteerPage();
      let receivedOptions = null;
      const fn = async (options) => {
        receivedOptions = options;
        return 'result';
      };

      const wrapped = withTextSelectorSupport(fn, 'puppeteer', page);
      const result = await wrapped({ selector: 'button', otherOption: true });

      assert.strictEqual(result, 'result');
      assert.ok(receivedOptions);
      assert.strictEqual(receivedOptions.selector, 'button');
      assert.strictEqual(receivedOptions.otherOption, true);
    });

    it('should pass through string selectors unchanged for Puppeteer', async () => {
      const page = createMockPuppeteerPage();
      let receivedSelector = null;
      const fn = async (options) => {
        receivedSelector = options.selector;
      };

      const wrapped = withTextSelectorSupport(fn, 'puppeteer', page);
      await wrapped({ selector: 'button' });

      assert.strictEqual(receivedSelector, 'button');
    });
  });

  describe('waitForSelector', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => waitForSelector({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should wait for selector with Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { button: { visible: true } },
      });
      const result = await waitForSelector({
        page,
        engine: 'playwright',
        selector: 'button',
        timeout: 1000,
      });
      assert.strictEqual(result, true);
    });

    it('should wait for selector with Puppeteer', async () => {
      const page = createMockPuppeteerPage({
        elements: { button: { visible: true } },
      });
      const result = await waitForSelector({
        page,
        engine: 'puppeteer',
        selector: 'button',
        timeout: 1000,
      });
      assert.strictEqual(result, true);
    });

    it('should handle navigation errors with throwOnNavigation false', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        waitFor: async () => {
          throw new Error('Execution context was destroyed');
        },
      });

      const result = await waitForSelector({
        page,
        engine: 'playwright',
        selector: 'button',
        throwOnNavigation: false,
      });
      assert.strictEqual(result, false);
    });
  });
});
