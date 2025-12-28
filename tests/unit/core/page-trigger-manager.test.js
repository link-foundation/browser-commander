import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  ActionStoppedError,
  isActionStoppedError,
  makeUrlCondition,
  allConditions,
  anyCondition,
  notCondition,
  createPageTriggerManager,
} from '../../../src/core/page-trigger-manager.js';
import {
  createMockNavigationManager,
  createMockLogger,
} from '../../helpers/mocks.js';

describe('page-trigger-manager', () => {
  describe('ActionStoppedError', () => {
    it('should create error with default message', () => {
      const error = new ActionStoppedError();
      assert.strictEqual(error.name, 'ActionStoppedError');
      assert.strictEqual(error.message, 'Action stopped due to navigation');
      assert.strictEqual(error.isActionStopped, true);
    });

    it('should create error with custom message', () => {
      const error = new ActionStoppedError('Custom message');
      assert.strictEqual(error.message, 'Custom message');
      assert.strictEqual(error.isActionStopped, true);
    });

    it('should be instance of Error', () => {
      const error = new ActionStoppedError();
      assert.ok(error instanceof Error);
    });
  });

  describe('isActionStoppedError', () => {
    it('should return true for ActionStoppedError', () => {
      const error = new ActionStoppedError();
      assert.strictEqual(isActionStoppedError(error), true);
    });

    it('should return true for error with isActionStopped flag', () => {
      const error = new Error('Some error');
      error.isActionStopped = true;
      assert.strictEqual(isActionStoppedError(error), true);
    });

    it('should return true for error with ActionStoppedError name', () => {
      const error = new Error('Some error');
      error.name = 'ActionStoppedError';
      assert.strictEqual(isActionStoppedError(error), true);
    });

    it('should return false for regular error', () => {
      const error = new Error('Regular error');
      assert.strictEqual(isActionStoppedError(error), false);
    });

    it('should return falsy for null', () => {
      assert.ok(!isActionStoppedError(null));
    });

    it('should return falsy for undefined', () => {
      assert.ok(!isActionStoppedError(undefined));
    });
  });

  describe('makeUrlCondition', () => {
    describe('function patterns', () => {
      it('should wrap function pattern', () => {
        const condition = makeUrlCondition((url) => url.includes('test'));
        assert.strictEqual(condition({ url: 'https://test.com' }), true);
        assert.strictEqual(condition({ url: 'https://example.com' }), false);
      });

      it('should pass context to function', () => {
        const condition = makeUrlCondition(
          (url, ctx) => ctx.someValue === true
        );
        assert.strictEqual(
          condition({ url: 'https://test.com', someValue: true }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://test.com', someValue: false }),
          false
        );
      });
    });

    describe('RegExp patterns', () => {
      it('should match RegExp pattern', () => {
        const condition = makeUrlCondition(/\/product\/\d+/);
        assert.strictEqual(
          condition({ url: 'https://example.com/product/123' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/product/' }),
          false
        );
      });
    });

    describe('string patterns', () => {
      it('should match exact URL', () => {
        const condition = makeUrlCondition('https://example.com/page');
        assert.strictEqual(
          condition({ url: 'https://example.com/page' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/page?foo=bar' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/other' }),
          false
        );
      });

      it('should match *substring* pattern (contains)', () => {
        const condition = makeUrlCondition('*checkout*');
        assert.strictEqual(
          condition({ url: 'https://example.com/checkout/step1' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://checkout.example.com' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/cart' }),
          false
        );
      });

      it('should match *suffix pattern (ends with)', () => {
        const condition = makeUrlCondition('*.json');
        assert.strictEqual(
          condition({ url: 'https://api.example.com/data.json' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://api.example.com/data.xml' }),
          false
        );
      });

      it('should match prefix* pattern (starts with)', () => {
        const condition = makeUrlCondition('/api/*');
        assert.strictEqual(condition({ url: '/api/users' }), true);
        assert.strictEqual(condition({ url: '/api/products' }), true);
        assert.strictEqual(condition({ url: '/web/page' }), false);
      });

      it('should match express-style :param patterns', () => {
        const condition = makeUrlCondition('/vacancy/:id');
        assert.strictEqual(condition({ url: '/vacancy/123' }), true);
        assert.strictEqual(condition({ url: '/vacancy/abc' }), true);
        assert.strictEqual(condition({ url: '/vacancy/' }), false);
      });

      it('should match express-style patterns with multiple params', () => {
        const condition = makeUrlCondition('/user/:userId/profile');
        assert.strictEqual(condition({ url: '/user/123/profile' }), true);
        assert.strictEqual(condition({ url: '/user/abc/profile' }), true); // Params match any non-slash chars
        assert.strictEqual(condition({ url: '/user//profile' }), false); // Empty param doesn't match
      });

      it('should match URL containing path (no wildcards, no params)', () => {
        const condition = makeUrlCondition('/admin');
        assert.strictEqual(
          condition({ url: 'https://example.com/admin/dashboard' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/user' }),
          false
        );
      });
    });

    describe('invalid patterns', () => {
      it('should throw for invalid pattern type', () => {
        assert.throws(() => makeUrlCondition(123), /Invalid URL pattern type/);
      });

      it('should throw for null pattern', () => {
        assert.throws(() => makeUrlCondition(null), /Invalid URL pattern type/);
      });
    });
  });

  describe('condition combinators', () => {
    describe('allConditions', () => {
      it('should return true when all conditions match', () => {
        const condition = allConditions(
          makeUrlCondition('*example.com*'),
          makeUrlCondition('*checkout*')
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/checkout' }),
          true
        );
      });

      it('should return false when any condition fails', () => {
        const condition = allConditions(
          makeUrlCondition('*example.com*'),
          makeUrlCondition('*checkout*')
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/cart' }),
          false
        );
      });
    });

    describe('anyCondition', () => {
      it('should return true when any condition matches', () => {
        const condition = anyCondition(
          makeUrlCondition('*cart*'),
          makeUrlCondition('*checkout*')
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/cart' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/checkout' }),
          true
        );
      });

      it('should return false when no conditions match', () => {
        const condition = anyCondition(
          makeUrlCondition('*cart*'),
          makeUrlCondition('*checkout*')
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/home' }),
          false
        );
      });
    });

    describe('notCondition', () => {
      it('should negate condition', () => {
        const condition = notCondition(makeUrlCondition('*admin*'));
        assert.strictEqual(
          condition({ url: 'https://example.com/user' }),
          true
        );
        assert.strictEqual(
          condition({ url: 'https://example.com/admin' }),
          false
        );
      });
    });
  });

  describe('createPageTriggerManager', () => {
    let navigationManager;
    let log;

    beforeEach(() => {
      navigationManager = createMockNavigationManager();
      log = createMockLogger();
    });

    it('should throw error when navigationManager is not provided', () => {
      assert.throws(
        () => createPageTriggerManager({ log }),
        /navigationManager is required/
      );
    });

    it('should create page trigger manager', () => {
      const manager = createPageTriggerManager({ navigationManager, log });
      assert.ok(manager);
      assert.ok(typeof manager.pageTrigger === 'function');
      assert.ok(typeof manager.stopCurrentAction === 'function');
      assert.ok(typeof manager.isRunning === 'function');
      assert.ok(typeof manager.destroy === 'function');
    });

    it('should register a trigger', () => {
      const manager = createPageTriggerManager({ navigationManager, log });

      const unregister = manager.pageTrigger({
        name: 'test-trigger',
        condition: () => true,
        action: async () => {},
      });

      assert.ok(typeof unregister === 'function');
    });

    it('should throw when condition is not a function', () => {
      const manager = createPageTriggerManager({ navigationManager, log });

      assert.throws(
        () =>
          manager.pageTrigger({
            name: 'test',
            condition: 'not-a-function',
            action: async () => {},
          }),
        /condition must be a function/
      );
    });

    it('should throw when action is not a function', () => {
      const manager = createPageTriggerManager({ navigationManager, log });

      assert.throws(
        () =>
          manager.pageTrigger({
            name: 'test',
            condition: () => true,
            action: 'not-a-function',
          }),
        /action must be a function/
      );
    });

    it('should unregister trigger', () => {
      const manager = createPageTriggerManager({ navigationManager, log });

      const unregister = manager.pageTrigger({
        name: 'test-trigger',
        condition: () => true,
        action: async () => {},
      });

      // Should not throw
      unregister();
    });

    it('should report not running initially', () => {
      const manager = createPageTriggerManager({ navigationManager, log });
      assert.strictEqual(manager.isRunning(), false);
    });

    it('should return null for getCurrentTriggerName when no action running', () => {
      const manager = createPageTriggerManager({ navigationManager, log });
      assert.strictEqual(manager.getCurrentTriggerName(), null);
    });

    it('should destroy without error', async () => {
      const manager = createPageTriggerManager({ navigationManager, log });
      await manager.destroy();
    });
  });
});
