import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  defaultScrollVerification,
  verifyScroll,
  scrollIntoView,
  needsScrolling,
  scrollIntoViewIfNeeded,
} from '../../../src/interactions/scroll.js';
import {
  createMockPlaywrightPage,
  createMockPuppeteerPage,
  createMockLogger,
} from '../../helpers/mocks.js';

describe('scroll', () => {
  describe('defaultScrollVerification', () => {
    it('should verify element is in viewport for Playwright', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        evaluate: async (fn, margin) => true, // Element is in viewport
      };
      const result = await defaultScrollVerification({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
      });
      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.inViewport, true);
    });

    it('should return false when element not in viewport', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        evaluate: async (fn, margin) => false, // Element not in viewport
      };
      const result = await defaultScrollVerification({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
      });
      assert.strictEqual(result.verified, false);
      assert.strictEqual(result.inViewport, false);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        evaluate: async () => {
          throw new Error('Execution context was destroyed');
        },
      };
      const result = await defaultScrollVerification({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
      });
      assert.strictEqual(result.verified, false);
      assert.strictEqual(result.navigationError, true);
    });
  });

  describe('verifyScroll', () => {
    it('should verify scroll with retry logic', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const mockLocator = {
        evaluate: async () => true,
      };

      const result = await verifyScroll({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        log,
        timeout: 100,
      });

      assert.strictEqual(result.verified, true);
      assert.ok(result.attempts >= 1);
    });

    it('should fail after timeout if element never in viewport', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const mockLocator = {
        evaluate: async () => false,
      };

      const result = await verifyScroll({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        log,
        timeout: 50,
        retryInterval: 10,
      });

      assert.strictEqual(result.verified, false);
      assert.ok(result.attempts >= 1);
    });
  });

  describe('scrollIntoView', () => {
    it('should throw when locatorOrElement is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => scrollIntoView({ page, engine: 'playwright' }),
        /locatorOrElement is required/
      );
    });

    it('should scroll element into view for Playwright', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      let scrollCalled = false;
      const mockLocator = {
        evaluate: async (fn, behavior) => {
          scrollCalled = true;
          return true;
        },
      };

      const result = await scrollIntoView({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        log,
        verify: false,
      });

      assert.strictEqual(result.scrolled, true);
      assert.strictEqual(scrollCalled, true);
    });

    it('should use smooth behavior by default', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      let receivedBehavior = null;
      const mockLocator = {
        evaluate: async (fn, behavior) => {
          receivedBehavior = behavior;
          return true;
        },
      };

      await scrollIntoView({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        log,
        verify: false,
      });

      assert.strictEqual(receivedBehavior, 'smooth');
    });

    it('should use instant behavior when specified', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      let receivedBehavior = null;
      const mockLocator = {
        evaluate: async (fn, behavior) => {
          receivedBehavior = behavior;
          return true;
        },
      };

      await scrollIntoView({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        behavior: 'instant',
        log,
        verify: false,
      });

      assert.strictEqual(receivedBehavior, 'instant');
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const mockLocator = {
        evaluate: async () => {
          throw new Error('Execution context was destroyed');
        },
      };

      const result = await scrollIntoView({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
        log,
        verify: false,
      });

      assert.strictEqual(result.scrolled, false);
      assert.strictEqual(result.verified, false);
    });
  });

  describe('needsScrolling', () => {
    it('should throw when locatorOrElement is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => needsScrolling({ page, engine: 'playwright' }),
        /locatorOrElement is required/
      );
    });

    it('should return true when element needs scrolling', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        evaluate: async () => true, // needs scrolling
      };

      const result = await needsScrolling({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
      });

      assert.strictEqual(result, true);
    });

    it('should return false when element is in view', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        evaluate: async () => false, // doesn't need scrolling
      };

      const result = await needsScrolling({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
      });

      assert.strictEqual(result, false);
    });

    it('should handle navigation errors', async () => {
      const page = createMockPlaywrightPage();
      const mockLocator = {
        evaluate: async () => {
          throw new Error('Execution context was destroyed');
        },
      };

      const result = await needsScrolling({
        page,
        engine: 'playwright',
        locatorOrElement: mockLocator,
      });

      assert.strictEqual(result, false);
    });
  });

  describe('scrollIntoViewIfNeeded', () => {
    it('should throw when locatorOrElement is not provided', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};

      await assert.rejects(
        () => scrollIntoViewIfNeeded({ page, engine: 'playwright', log, wait }),
        /locatorOrElement is required/
      );
    });

    it('should skip scrolling when element is in view', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};
      let scrollCalled = false;
      const mockLocator = {
        evaluate: async (fn, arg) => {
          // First call checks if scrolling needed, second is for scroll
          if (!scrollCalled) {
            return false; // doesn't need scrolling
          }
          scrollCalled = true;
          return true;
        },
      };

      const result = await scrollIntoViewIfNeeded({
        page,
        engine: 'playwright',
        log,
        wait,
        locatorOrElement: mockLocator,
      });

      assert.strictEqual(result.scrolled, false);
      assert.strictEqual(result.skipped, true);
      assert.strictEqual(result.verified, true);
    });

    it('should scroll when element needs scrolling', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const wait = async () => {};
      let callCount = 0;
      const mockLocator = {
        evaluate: async (fn, arg) => {
          callCount++;
          if (callCount === 1) {
            return true; // needs scrolling
          }
          // Subsequent calls are for scroll and verification
          return true;
        },
      };

      const result = await scrollIntoViewIfNeeded({
        page,
        engine: 'playwright',
        log,
        wait,
        locatorOrElement: mockLocator,
        verify: false,
      });

      assert.strictEqual(result.scrolled, true);
      assert.strictEqual(result.skipped, false);
    });
  });
});
