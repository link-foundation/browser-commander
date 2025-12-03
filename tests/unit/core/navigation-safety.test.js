import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  isNavigationError,
  safeOperation,
  makeNavigationSafe,
  withNavigationSafety,
} from '../../../src/core/navigation-safety.js';

describe('navigation-safety', () => {
  describe('isNavigationError', () => {
    it('should return false for null', () => {
      assert.strictEqual(isNavigationError(null), false);
    });

    it('should return false for undefined', () => {
      assert.strictEqual(isNavigationError(undefined), false);
    });

    it('should return false for error without message', () => {
      assert.strictEqual(isNavigationError({}), false);
    });

    it('should return false for regular error', () => {
      const error = new Error('Some regular error');
      assert.strictEqual(isNavigationError(error), false);
    });

    it('should return true for "Execution context was destroyed" error', () => {
      const error = new Error('Execution context was destroyed');
      assert.strictEqual(isNavigationError(error), true);
    });

    it('should return true for "detached Frame" error', () => {
      const error = new Error('Element is a detached Frame');
      assert.strictEqual(isNavigationError(error), true);
    });

    it('should return true for "Target closed" error', () => {
      const error = new Error('Target closed');
      assert.strictEqual(isNavigationError(error), true);
    });

    it('should return true for "Session closed" error', () => {
      const error = new Error('Session closed');
      assert.strictEqual(isNavigationError(error), true);
    });

    it('should return true for "Protocol error" error', () => {
      const error = new Error('Protocol error');
      assert.strictEqual(isNavigationError(error), true);
    });

    it('should return true for "frame was detached" error', () => {
      const error = new Error('frame was detached');
      assert.strictEqual(isNavigationError(error), true);
    });

    it('should return true for "Page crashed" error', () => {
      const error = new Error('Page crashed');
      assert.strictEqual(isNavigationError(error), true);
    });

    it('should return true for "context was destroyed" error', () => {
      const error = new Error('context was destroyed');
      assert.strictEqual(isNavigationError(error), true);
    });
  });

  describe('safeOperation', () => {
    it('should return success result on successful operation', async () => {
      const result = await safeOperation(async () => 'success');
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.value, 'success');
      assert.strictEqual(result.navigationError, false);
    });

    it('should return default value on navigation error', async () => {
      const result = await safeOperation(
        async () => { throw new Error('Execution context was destroyed'); },
        { defaultValue: 'default', silent: true }
      );
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.value, 'default');
      assert.strictEqual(result.navigationError, true);
    });

    it('should rethrow non-navigation errors', async () => {
      await assert.rejects(
        async () => safeOperation(async () => { throw new Error('Regular error'); }),
        /Regular error/
      );
    });

    it('should use null as default value when not specified', async () => {
      const result = await safeOperation(
        async () => { throw new Error('Execution context was destroyed'); },
        { silent: true }
      );
      assert.strictEqual(result.value, null);
    });

    it('should handle operation name for logging', async () => {
      const result = await safeOperation(
        async () => { throw new Error('Execution context was destroyed'); },
        { operationName: 'test operation', silent: true }
      );
      assert.strictEqual(result.navigationError, true);
    });
  });

  describe('makeNavigationSafe', () => {
    it('should wrap async function', async () => {
      const fn = async () => 'result';
      const safeFn = makeNavigationSafe(fn);
      const result = await safeFn();
      assert.strictEqual(result, 'result');
    });

    it('should return default value on navigation error', async () => {
      const fn = async () => { throw new Error('Execution context was destroyed'); };
      const safeFn = makeNavigationSafe(fn, 'default');
      const result = await safeFn();
      assert.strictEqual(result, 'default');
    });

    it('should pass arguments to wrapped function', async () => {
      const fn = async (a, b) => a + b;
      const safeFn = makeNavigationSafe(fn);
      const result = await safeFn(1, 2);
      assert.strictEqual(result, 3);
    });
  });

  describe('withNavigationSafety', () => {
    it('should return function result on success', async () => {
      const fn = async () => 'success';
      const safeFn = withNavigationSafety(fn);
      const result = await safeFn();
      assert.strictEqual(result, 'success');
    });

    it('should call onNavigationError callback on navigation error', async () => {
      let called = false;
      const fn = async () => { throw new Error('Execution context was destroyed'); };
      const safeFn = withNavigationSafety(fn, {
        onNavigationError: () => {
          called = true;
          return 'handled';
        },
      });
      const result = await safeFn();
      assert.strictEqual(called, true);
      assert.strictEqual(result, 'handled');
    });

    it('should return undefined when rethrow is false and no callback', async () => {
      const fn = async () => { throw new Error('Execution context was destroyed'); };
      const safeFn = withNavigationSafety(fn, { rethrow: false });
      const result = await safeFn();
      assert.strictEqual(result, undefined);
    });

    it('should rethrow navigation error when rethrow is true and no callback', async () => {
      const fn = async () => { throw new Error('Execution context was destroyed'); };
      const safeFn = withNavigationSafety(fn, { rethrow: true });
      await assert.rejects(safeFn, /Execution context was destroyed/);
    });

    it('should rethrow non-navigation errors', async () => {
      const fn = async () => { throw new Error('Regular error'); };
      const safeFn = withNavigationSafety(fn);
      await assert.rejects(safeFn, /Regular error/);
    });

    it('should pass arguments through', async () => {
      const fn = async (x) => x * 2;
      const safeFn = withNavigationSafety(fn);
      const result = await safeFn(5);
      assert.strictEqual(result, 10);
    });
  });
});
