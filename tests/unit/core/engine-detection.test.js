import { describe, it } from 'node:test';
import assert from 'node:assert';
import { detectEngine } from '../../../src/core/engine-detection.js';
import { createMockPlaywrightPage, createMockPuppeteerPage } from '../../helpers/mocks.js';

describe('engine-detection', () => {
  describe('detectEngine', () => {
    it('should detect Playwright page', () => {
      const mockPage = createMockPlaywrightPage();
      // Add Playwright-specific methods
      mockPage.locator = (selector) => ({});
      mockPage.context = () => ({});

      const engine = detectEngine(mockPage);
      assert.strictEqual(engine, 'playwright');
    });

    it('should detect Puppeteer page', () => {
      const mockPage = {
        $eval: async () => {},
        $$eval: async () => {},
        $: async () => {},
        $$: async () => {},
        // Puppeteer does NOT have locator or context methods
      };

      const engine = detectEngine(mockPage);
      assert.strictEqual(engine, 'puppeteer');
    });

    it('should throw error for unknown engine', () => {
      const mockPage = {
        // No recognizable methods
        someMethod: () => {},
      };

      assert.throws(() => {
        detectEngine(mockPage);
      }, /Unknown browser automation engine/);
    });

    it('should detect Playwright when locator is function and context exists', () => {
      const mockPage = {
        $eval: async () => {},
        $$eval: async () => {},
        locator: (selector) => ({}),
        context: () => ({}),
      };

      const engine = detectEngine(mockPage);
      assert.strictEqual(engine, 'playwright');
    });

    it('should detect Puppeteer when $eval exists but no context', () => {
      const mockPage = {
        $eval: async () => {},
        $$eval: async () => {},
        // No locator as function, no context
        locator: 'not-a-function',
      };

      const engine = detectEngine(mockPage);
      assert.strictEqual(engine, 'puppeteer');
    });

    it('should handle page with context as object', () => {
      const mockPage = {
        $eval: async () => {},
        $$eval: async () => {},
        locator: (selector) => ({}),
        context: {}, // context as object, not function
      };

      const engine = detectEngine(mockPage);
      assert.strictEqual(engine, 'playwright');
    });
  });
});
