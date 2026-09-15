import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createNavigationManager } from '../../../src/core/navigation-manager.js';
import {
  createMockPlaywrightPage,
  createMockLogger,
  createMockNetworkTracker,
} from '../../helpers/mocks.js';
import { READINESS_STATUS } from '../../../src/core/readiness.js';

/**
 * Build a navigation manager wired to a network tracker whose idle wait is
 * fully controlled by the test.
 */
function createManagerWithNetwork(options = {}) {
  const { idle = true, onIdleWait = () => {} } = options;
  const page = createMockPlaywrightPage();
  const log = createMockLogger();
  const networkTracker = createMockNetworkTracker();
  networkTracker.waitForNetworkIdle = async (opts = {}) => {
    onIdleWait(opts);
    return typeof idle === 'function' ? await idle(opts) : idle;
  };

  const manager = createNavigationManager({
    page,
    engine: 'playwright',
    log,
    networkTracker,
  });
  manager.configure({ redirectStabilizationTime: 0 });
  return { manager, page, log, networkTracker };
}

describe('navigation manager', () => {
  describe('setContent', () => {
    it('should apply the full managed navigation lifecycle', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const calls = [];
      page.setContent = async (...args) => calls.push(['setContent', ...args]);

      const manager = createNavigationManager({
        page,
        engine: 'playwright',
        log,
      });
      manager.configure({ redirectStabilizationTime: 0 });
      manager.onSessionCleanup(() => calls.push(['cleanup']));
      manager.on('onNavigationStart', () => calls.push(['navigationStart']));
      manager.on('onPageReady', () => calls.push(['pageReady']));

      const loaded = await manager.setContent({
        html: '<h1>Hi</h1>',
        waitUntil: 'networkidle',
        timeout: 5000,
      });

      assert.strictEqual(loaded, true);
      assert.strictEqual(manager.getSessionId(), 1);
      assert.strictEqual(manager.isNavigating(), false);
      assert.deepStrictEqual(calls, [
        ['cleanup'],
        ['navigationStart'],
        [
          'setContent',
          '<h1>Hi</h1>',
          { waitUntil: 'networkidle', timeout: 5000 },
        ],
        ['pageReady'],
      ]);
    });

    it('should require html while accepting an empty string', async () => {
      const page = createMockPlaywrightPage();
      const log = createMockLogger();
      const manager = createNavigationManager({
        page,
        engine: 'playwright',
        log,
      });
      manager.configure({ redirectStabilizationTime: 0 });

      await assert.rejects(() => manager.setContent(), /html is required/);
      await assert.doesNotReject(() => manager.setContent({ html: '' }));
    });
  });

  describe('waitForReady', () => {
    it('should never extend the caller deadline beyond the timeout', async () => {
      // Regression test for issue #89: the old implementation waited
      // `Math.max(60000, timeout - elapsed)`, so a 500ms budget could block for
      // a full minute.
      const idleTimeouts = [];
      const { manager } = createManagerWithNetwork({
        idle: true,
        onIdleWait: (opts) => idleTimeouts.push(opts.timeout),
      });

      await manager.waitForReady({ timeout: 1000, reason: 'deadline test' });

      assert.strictEqual(idleTimeouts.length, 1);
      assert.ok(
        idleTimeouts[0] <= 1000,
        `network idle timeout ${idleTimeouts[0]} exceeded the 1000ms budget`
      );
    });

    it('should report timed_out instead of claiming the page is ready', async () => {
      // Regression test for issue #89: `waitForPageReady` logged "Page ready"
      // and returned true even after network idle had failed.
      const { manager } = createManagerWithNetwork({
        // Burn the whole remaining budget, the way a real idle wait does.
        idle: async (opts) => {
          await new Promise((resolve) => setTimeout(resolve, opts.timeout));
          return false;
        },
      });

      const result = await manager.waitForReady({
        timeout: 600,
        reason: 'failure test',
      });

      assert.strictEqual(result.ready, false);
      assert.strictEqual(result.status, READINESS_STATUS.TIMED_OUT);
      assert.ok(result.checks.failed.includes('networkIdleFor'));
      assert.ok(
        result.elapsedMs < 3000,
        `wait took ${result.elapsedMs}ms for a 600ms budget`
      );
    });

    it('should report failed when a check fails before the deadline', async () => {
      const { manager } = createManagerWithNetwork({ idle: false });

      const result = await manager.waitForReady({ timeout: 5000 });

      assert.strictEqual(result.ready, false);
      assert.strictEqual(result.status, READINESS_STATUS.FAILED);
      assert.ok(result.checks.failed.includes('networkIdleFor'));
    });

    it('should not emit onPageReady after a failed wait', async () => {
      // Regression test for issue #89: cleanup and the ready event were both
      // owned by completeNavigation(), so failing waits still announced ready.
      const { manager } = createManagerWithNetwork({ idle: false });
      const events = [];
      manager.on('onPageReady', () => events.push('pageReady'));
      manager.on('onNavigationComplete', (payload) =>
        events.push(`complete:${payload.ready}`)
      );

      const ready = await manager.navigate({
        url: 'https://example.com',
        timeout: 1000,
      });

      assert.strictEqual(ready, false);
      assert.ok(!events.includes('pageReady'));
      assert.ok(events.includes('complete:false'));
      assert.strictEqual(manager.isNavigating(), false);
    });

    it('should emit onPageReady exactly once when every check passes', async () => {
      const { manager } = createManagerWithNetwork({ idle: true });
      const events = [];
      manager.on('onPageReady', () => events.push('pageReady'));

      const result = await manager.waitForReady({ timeout: 2000 });

      assert.strictEqual(result.ready, true);
      assert.strictEqual(result.status, READINESS_STATUS.READY);
      assert.deepStrictEqual(events, ['pageReady']);
      assert.ok(result.checks.satisfied.includes('networkIdleFor'));
    });

    it('should record evidence for every check it ran', async () => {
      const { manager } = createManagerWithNetwork({ idle: true });

      const result = await manager.waitForReady({ timeout: 2000 });

      assert.ok(Array.isArray(result.evidence));
      assert.ok(result.evidence.length >= 2);
      for (const entry of result.evidence) {
        assert.strictEqual(typeof entry.name, 'string');
        assert.strictEqual(typeof entry.satisfied, 'boolean');
        assert.strictEqual(typeof entry.elapsedMs, 'number');
      }
    });

    it('should stop running checks once the deadline is exhausted', async () => {
      let secondCheckRan = false;
      const { manager } = createManagerWithNetwork({ idle: true });

      const slow = {
        name: 'slow',
        async run({ deadline }) {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return {
            satisfied: false,
            detail: { remaining: deadline.remainingMs() },
          };
        },
      };
      const second = {
        name: 'second',
        async run() {
          secondCheckRan = true;
          return { satisfied: true };
        },
      };

      const result = await manager.waitForReady({
        timeout: 50,
        checks: [slow, second],
      });

      assert.strictEqual(result.ready, false);
      assert.strictEqual(secondCheckRan, false);
      assert.ok(result.checks.pending.includes('second'));
    });
  });
});
