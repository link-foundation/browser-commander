import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  textContent,
  inputValue,
  getAttribute,
  getInputValue,
  logElementInfo,
} from '../../../src/elements/content.js';
import { createMockPlaywrightPage, createMockPuppeteerPage, createMockLogger } from '../../helpers/mocks.js';

describe('content', () => {
  describe('textContent', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => textContent({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should return text content for Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'div': { textContent: 'Hello World', count: 1 } },
      });
      const text = await textContent({
        page,
        engine: 'playwright',
        selector: 'div',
      });
      assert.strictEqual(text, 'Hello World');
    });

    it('should return text content for Puppeteer', async () => {
      const page = createMockPuppeteerPage({
        elements: { 'div': { textContent: 'Hello World', count: 1 } },
      });
      // Override evaluate to properly return textContent for this test
      page.evaluate = async (fn, el) => {
        // The fn is like: el => el.textContent
        // Return the configured text content
        return 'Hello World';
      };
      const text = await textContent({
        page,
        engine: 'puppeteer',
        selector: 'div',
      });
      assert.strictEqual(text, 'Hello World');
    });

    it('should return null when element not found', async () => {
      const page = createMockPuppeteerPage({
        elements: { 'div': { count: 0 } },
      });
      const text = await textContent({
        page,
        engine: 'puppeteer',
        selector: 'div',
      });
      assert.strictEqual(text, null);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        textContent: async () => {
          throw new Error('Execution context was destroyed');
        },
      });
      const text = await textContent({
        page,
        engine: 'playwright',
        selector: 'div',
      });
      assert.strictEqual(text, null);
    });
  });

  describe('inputValue', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => inputValue({ page, engine: 'playwright' }),
        /selector is required/
      );
    });

    it('should return input value for Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'input': { value: 'test value', count: 1 } },
      });
      const value = await inputValue({
        page,
        engine: 'playwright',
        selector: 'input',
      });
      assert.strictEqual(value, 'test value');
    });

    it('should return input value for Puppeteer', async () => {
      const page = createMockPuppeteerPage({
        elements: { 'input': { value: 'test value', count: 1 } },
      });
      // Override evaluate to properly return value for this test
      page.evaluate = async (fn, el) => {
        // The fn is like: el => el.value
        // Return the configured value
        return 'test value';
      };
      const value = await inputValue({
        page,
        engine: 'puppeteer',
        selector: 'input',
      });
      assert.strictEqual(value, 'test value');
    });

    it('should return empty string when element not found', async () => {
      const page = createMockPuppeteerPage({
        elements: { 'input': { count: 0 } },
      });
      const value = await inputValue({
        page,
        engine: 'puppeteer',
        selector: 'input',
      });
      assert.strictEqual(value, '');
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        inputValue: async () => {
          throw new Error('Execution context was destroyed');
        },
      });
      const value = await inputValue({
        page,
        engine: 'playwright',
        selector: 'input',
      });
      assert.strictEqual(value, '');
    });
  });

  describe('getAttribute', () => {
    it('should throw when selector is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => getAttribute({ page, engine: 'playwright', attribute: 'href' }),
        /selector and attribute are required/
      );
    });

    it('should throw when attribute is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => getAttribute({ page, engine: 'playwright', selector: 'a' }),
        /selector and attribute are required/
      );
    });

    it('should return attribute value for Playwright', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'a': { href: 'https://example.com', count: 1 } },
      });
      const value = await getAttribute({
        page,
        engine: 'playwright',
        selector: 'a',
        attribute: 'href',
      });
      assert.strictEqual(value, 'https://example.com');
    });

    it('should return null when attribute not found', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'a': { count: 1 } },
      });
      const value = await getAttribute({
        page,
        engine: 'playwright',
        selector: 'a',
        attribute: 'nonexistent',
      });
      assert.strictEqual(value, null);
    });

    it('should return null when element not found', async () => {
      const page = createMockPuppeteerPage({
        elements: { 'a': { count: 0 } },
      });
      const value = await getAttribute({
        page,
        engine: 'puppeteer',
        selector: 'a',
        attribute: 'href',
      });
      assert.strictEqual(value, null);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.locator = () => ({
        getAttribute: async () => {
          throw new Error('Execution context was destroyed');
        },
      });
      const value = await getAttribute({
        page,
        engine: 'playwright',
        selector: 'a',
        attribute: 'href',
      });
      assert.strictEqual(value, null);
    });
  });

  describe('getInputValue', () => {
    it('should throw when locatorOrElement is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => getInputValue({ page, engine: 'playwright' }),
        /locatorOrElement is required/
      );
    });

    it('should return value from locator', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        inputValue: async () => 'locator value',
      };
      const adapter = {
        getInputValue: async () => 'adapter value',
      };
      const value = await getInputValue({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        adapter,
      });
      assert.strictEqual(value, 'adapter value');
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {};
      const adapter = {
        getInputValue: async () => {
          throw new Error('Execution context was destroyed');
        },
      };
      const value = await getInputValue({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        adapter,
      });
      assert.strictEqual(value, '');
    });
  });

  describe('logElementInfo', () => {
    it('should not throw when locatorOrElement is not provided', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      await logElementInfo({ page, engine: 'playwright', log });
      // Should not throw
    });

    it('should log element information', async () => {
      const page = createMockPlaywrightPage({
        elements: { 'button': { textContent: 'Click me', count: 1 } },
      });
      const log = createMockLogger({ collectLogs: true });
      const mockLocator = {
        evaluate: async (fn) => 'BUTTON',
        textContent: async () => 'Click me',
      };
      const adapter = {
        evaluateOnElement: async () => 'BUTTON',
        getTextContent: async () => 'Click me',
      };

      await logElementInfo({
        page,
        engine: 'playwright',
        log,
        locatorOrElement: mockLocator,
        adapter,
      });
      // Should log without error
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const mockLocator = {};
      const adapter = {
        evaluateOnElement: async () => {
          throw new Error('Execution context was destroyed');
        },
      };

      await logElementInfo({
        page,
        engine: 'playwright',
        log,
        locatorOrElement: mockLocator,
        adapter,
      });
      // Should not throw
    });
  });
});
