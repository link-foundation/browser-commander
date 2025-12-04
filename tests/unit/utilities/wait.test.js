import { describe, it } from 'node:test';
import assert from 'node:assert';
import { wait, evaluate, safeEvaluate } from '../../../src/utilities/wait.js';
import { createMockPlaywrightPage, createMockPuppeteerPage, createMockLogger } from '../../helpers/mocks.js';

describe('wait utilities', () => {
  describe('wait', () => {
    it('should throw when ms is not provided', async () => {
      const log = createMockLogger();
      await assert.rejects(
        () => wait({ log }),
        /ms is required/
      );
    });

    it('should wait for specified time', async () => {
      const log = createMockLogger();
      const start = Date.now();
      await wait({ log, ms: 50 });
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 45, `Expected at least 45ms, got ${elapsed}`);
    });

    it('should return completed status without abort signal', async () => {
      const log = createMockLogger();
      const result = await wait({ log, ms: 10 });
      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.aborted, false);
    });

    it('should accept reason for logging', async () => {
      const log = createMockLogger({ collectLogs: true });
      await wait({ log, ms: 10, reason: 'test wait' });
      // Should not throw
    });

    it('should handle abort signal that is already aborted', async () => {
      const log = createMockLogger();
      const controller = new AbortController();
      controller.abort();

      const result = await wait({
        log,
        ms: 1000,
        abortSignal: controller.signal,
      });

      assert.strictEqual(result.completed, false);
      assert.strictEqual(result.aborted, true);
    });

    it('should abort wait when signal is aborted', async () => {
      const log = createMockLogger();
      const controller = new AbortController();

      const waitPromise = wait({
        log,
        ms: 10000,
        abortSignal: controller.signal,
      });

      // Abort after a short delay
      setTimeout(() => controller.abort(), 10);

      const result = await waitPromise;
      assert.strictEqual(result.completed, false);
      assert.strictEqual(result.aborted, true);
    });

    it('should complete when not aborted', async () => {
      const log = createMockLogger();
      const controller = new AbortController();

      const result = await wait({
        log,
        ms: 10,
        abortSignal: controller.signal,
      });

      assert.strictEqual(result.completed, true);
      assert.strictEqual(result.aborted, false);
    });
  });

  describe('evaluate', () => {
    it('should throw when fn is not provided', async () => {
      const page = createMockPlaywrightPage();
      await assert.rejects(
        () => evaluate({ page, engine: 'playwright' }),
        /fn is required/
      );
    });

    it('should evaluate function on Playwright page', async () => {
      const page = createMockPlaywrightPage({ evaluateResult: 'result' });
      const result = await evaluate({
        page,
        engine: 'playwright',
        fn: () => 'result',
      });
      assert.strictEqual(result, 'result');
    });

    it('should evaluate function on Puppeteer page', async () => {
      const page = createMockPuppeteerPage({ evaluateResult: 'result' });
      const result = await evaluate({
        page,
        engine: 'puppeteer',
        fn: () => 'result',
      });
      assert.strictEqual(result, 'result');
    });

    it('should pass arguments to function', async () => {
      const page = createMockPlaywrightPage();
      // Our mock doesn't actually execute the function with args, so we'll test the interface
      await evaluate({
        page,
        engine: 'playwright',
        fn: (a, b) => a + b,
        args: [1, 2],
      });
      // Should not throw
    });

    it('should use provided adapter', async () => {
      const page = createMockPlaywrightPage();
      const customAdapter = {
        evaluateOnPage: async (fn, args) => 'custom result',
      };
      const result = await evaluate({
        page,
        engine: 'playwright',
        fn: () => 'test',
        adapter: customAdapter,
      });
      assert.strictEqual(result, 'custom result');
    });
  });

  describe('safeEvaluate', () => {
    it('should return success result on successful evaluation', async () => {
      const page = createMockPlaywrightPage({ evaluateResult: 'success' });
      const result = await safeEvaluate({
        page,
        engine: 'playwright',
        fn: () => 'success',
      });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 'success');
      assert.strictEqual(result.navigationError, false);
    });

    it('should return default value on navigation error', async () => {
      const page = createMockPlaywrightPage();
      page.evaluate = async () => {
        throw new Error('Execution context was destroyed');
      };

      const result = await safeEvaluate({
        page,
        engine: 'playwright',
        fn: () => 'test',
        defaultValue: 'default',
        silent: true,
      });

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.value, 'default');
      assert.strictEqual(result.navigationError, true);
    });

    it('should use null as default value when not specified', async () => {
      const page = createMockPlaywrightPage();
      page.evaluate = async () => {
        throw new Error('Execution context was destroyed');
      };

      const result = await safeEvaluate({
        page,
        engine: 'playwright',
        fn: () => 'test',
        silent: true,
      });

      assert.strictEqual(result.value, null);
    });

    it('should rethrow non-navigation errors', async () => {
      const page = createMockPlaywrightPage();
      page.evaluate = async () => {
        throw new Error('Regular error');
      };

      await assert.rejects(
        () => safeEvaluate({
          page,
          engine: 'playwright',
          fn: () => 'test',
        }),
        /Regular error/
      );
    });
  });
});
