import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  READINESS_STATUS,
  LONG_LIVED_REQUEST_PATTERNS,
  isLongLivedRequest,
  createDeadline,
  sleepWithinDeadline,
  stableCheck,
  urlStableFor,
  networkIdleFor,
  domStableFor,
  visibleImages,
  predicate,
  runReadinessChecks,
} from '../../../src/core/readiness.js';

/**
 * Deadline driven by a clock the test advances by hand, so budget assertions
 * are exact instead of timing-dependent.
 */
function createFakeClock(start = 0) {
  let value = start;
  return {
    now: () => value,
    advance: (ms) => {
      value += ms;
    },
  };
}

/**
 * Run one readiness check to completion under a fresh deadline.
 *
 * @param {Object} check - Readiness check to run
 * @param {Object} [context] - Extra context merged into the run arguments
 * @param {number} [timeout] - Deadline budget in milliseconds
 * @returns {Promise<Object>} Check outcome
 */
function runCheck(check, context = {}, timeout = 2000) {
  return check.run({ deadline: createDeadline({ timeout }), ...context });
}

describe('readiness', () => {
  describe('createDeadline', () => {
    it('should require a non-negative finite timeout', () => {
      assert.throws(() => createDeadline({}), TypeError);
      assert.throws(() => createDeadline({ timeout: -1 }), TypeError);
      assert.throws(() => createDeadline({ timeout: Infinity }), TypeError);
    });

    it('should report remaining budget that only ever shrinks', () => {
      const clock = createFakeClock();
      const deadline = createDeadline({ timeout: 1000, now: clock.now });

      assert.strictEqual(deadline.remainingMs(), 1000);
      assert.strictEqual(deadline.expired(), false);

      clock.advance(400);
      assert.strictEqual(deadline.elapsedMs(), 400);
      assert.strictEqual(deadline.remainingMs(), 600);

      clock.advance(5000);
      assert.strictEqual(deadline.remainingMs(), 0);
      assert.strictEqual(deadline.expired(), true);
    });

    it('should never hand out a bigger budget than the caller asked for', () => {
      // Regression test for issue #89: the old code used
      // `Math.max(60000, timeout - elapsed)`, which grew the budget instead of
      // shrinking it.
      const clock = createFakeClock();
      const deadline = createDeadline({ timeout: 500, now: clock.now });

      for (let step = 0; step < 10; step += 1) {
        assert.ok(deadline.remainingMs() <= 500);
        clock.advance(100);
      }
      assert.strictEqual(deadline.remainingMs(), 0);
    });

    it('should ignore a clock that jumps backwards', () => {
      let value = 1000;
      const deadline = createDeadline({ timeout: 1000, now: () => value });
      value = 0;
      assert.strictEqual(deadline.elapsedMs(), 0);
      assert.strictEqual(deadline.remainingMs(), 1000);
    });
  });

  describe('sleepWithinDeadline', () => {
    it('should not sleep past the deadline', async () => {
      const deadline = createDeadline({ timeout: 40 });
      const startedAt = Date.now();
      await sleepWithinDeadline(5000, deadline);
      assert.ok(Date.now() - startedAt < 1000);
    });
  });

  describe('isLongLivedRequest', () => {
    it('should ignore websockets, streams, analytics and polling', () => {
      const ignored = [
        'wss://example.com/live',
        'ws://example.com/socket',
        'https://example.com/socket.io/?EIO=4',
        'https://example.com/sse',
        'https://www.google-analytics.com/collect',
        'https://example.com/api/telemetry',
        'https://example.com/v1/longpoll',
      ];
      for (const url of ignored) {
        assert.ok(isLongLivedRequest(url), `${url} should be ignored`);
      }
    });

    it('should not ignore ordinary page resources', () => {
      const kept = [
        'https://example.com/index.html',
        'https://example.com/app.js',
        'https://example.com/api/users',
        'https://example.com/streamers/list',
      ];
      for (const url of kept) {
        assert.strictEqual(isLongLivedRequest(url), false, url);
      }
    });

    it('should tolerate missing and non-string urls', () => {
      assert.strictEqual(isLongLivedRequest(undefined), false);
      assert.strictEqual(isLongLivedRequest(''), false);
      assert.strictEqual(isLongLivedRequest(42), false);
    });

    it('should accept caller-supplied patterns', () => {
      assert.strictEqual(
        isLongLivedRequest('https://example.com/keepalive', [/keepalive/u]),
        true
      );
      assert.ok(LONG_LIVED_REQUEST_PATTERNS.length > 0);
    });
  });

  describe('stableCheck', () => {
    it('should require a name and a sampler', () => {
      assert.throws(() => stableCheck({}), TypeError);
      assert.throws(() => stableCheck({ name: 'x' }), TypeError);
    });

    it('should require the sampler to hold stable for the full window', async () => {
      const samples = [true, false, true, true, true, true];
      let index = 0;
      const check = stableCheck({
        name: 'flaky',
        stableForMs: 20,
        intervalMs: 5,
        sample: () => samples[Math.min(index++, samples.length - 1)],
      });

      const outcome = await runCheck(check);

      assert.strictEqual(outcome.satisfied, true);
      assert.ok(index > 3, 'the unstable sample must reset the window');
    });

    it('should give up when the deadline is reached', async () => {
      const check = stableCheck({
        name: 'never',
        stableForMs: 50,
        intervalMs: 5,
        sample: () => false,
      });

      const deadline = createDeadline({ timeout: 60 });
      const outcome = await check.run({ deadline });

      assert.strictEqual(outcome.satisfied, false);
      assert.strictEqual(outcome.detail.reason, 'deadline reached');
    });
  });

  describe('urlStableFor', () => {
    it('should report the url it settled on and notify the caller', async () => {
      const seen = [];
      const urls = ['https://a.test/', 'https://b.test/', 'https://b.test/'];
      let index = 0;
      const page = { url: () => urls[Math.min(index++, urls.length - 1)] };

      const check = urlStableFor({ stableForMs: 0, intervalMs: 5 });
      const outcome = await runCheck(check, {
        page,
        onUrlSample: (url) => seen.push(url),
      });

      assert.strictEqual(outcome.satisfied, true);
      assert.strictEqual(outcome.detail.url, 'https://b.test/');
      assert.ok(seen.includes('https://a.test/'));
    });
  });

  describe('networkIdleFor', () => {
    it('should skip when there is no network tracker', async () => {
      const deadline = createDeadline({ timeout: 1000 });
      const outcome = await networkIdleFor().run({ deadline });
      assert.strictEqual(outcome.skipped, true);
    });

    it('should hand the tracker only the remaining budget', async () => {
      const clock = createFakeClock();
      const deadline = createDeadline({ timeout: 1000, now: clock.now });
      clock.advance(700);

      let received = null;
      const networkTracker = {
        waitForNetworkIdle: async (opts) => {
          received = opts;
          return true;
        },
        getPendingCount: () => 0,
      };

      const outcome = await networkIdleFor().run({ deadline, networkTracker });

      assert.strictEqual(received.timeout, 300);
      assert.strictEqual(outcome.satisfied, true);
    });

    it('should fail rather than wait when the budget is gone', async () => {
      const clock = createFakeClock();
      const deadline = createDeadline({ timeout: 100, now: clock.now });
      clock.advance(500);

      let called = false;
      const networkTracker = {
        waitForNetworkIdle: async () => {
          called = true;
          return true;
        },
      };

      const outcome = await networkIdleFor().run({ deadline, networkTracker });

      assert.strictEqual(called, false);
      assert.strictEqual(outcome.satisfied, false);
      assert.strictEqual(outcome.detail.reason, 'no remaining budget');
    });

    it('should report the pending urls behind a failure', async () => {
      const deadline = createDeadline({ timeout: 1000 });
      const networkTracker = {
        waitForNetworkIdle: async () => false,
        getPendingCount: () => 2,
        getPendingUrls: () => ['https://example.com/slow'],
      };

      const outcome = await networkIdleFor().run({ deadline, networkTracker });

      assert.strictEqual(outcome.satisfied, false);
      assert.deepStrictEqual(outcome.detail.pendingUrls, [
        'https://example.com/slow',
      ]);
    });
  });

  describe('adapter-backed checks', () => {
    it('should resolve the adapter lazily through getAdapter', async () => {
      let resolved = 0;
      const adapter = {
        evaluateOnPage: async () => ({
          nodes: 10,
          length: 100,
          readyState: 'complete',
        }),
      };

      const check = domStableFor({ stableForMs: 0, intervalMs: 5 });
      const outcome = await runCheck(check, {
        getAdapter: async () => {
          resolved += 1;
          return adapter;
        },
      });

      assert.strictEqual(outcome.satisfied, true);
      assert.ok(resolved >= 1);
    });

    it('should surface a missing adapter as failure evidence', async () => {
      const check = visibleImages({ intervalMs: 5 });
      const deadline = createDeadline({ timeout: 30 });

      const result = await runReadinessChecks({ checks: [check], deadline });

      assert.strictEqual(result.ready, false);
      assert.ok(
        result.evidence[0].detail.error.includes('engine adapter'),
        result.evidence[0].detail.error
      );
    });

    it('should wait for in-viewport images to finish decoding', async () => {
      const states = [
        { total: 3, pending: 2 },
        { total: 3, pending: 0 },
      ];
      let index = 0;
      const adapter = {
        evaluateOnPage: async () => states[Math.min(index++, 1)],
      };

      const check = visibleImages({ intervalMs: 5 });
      const outcome = await runCheck(check, { adapter });

      assert.strictEqual(outcome.satisfied, true);
      assert.strictEqual(outcome.detail.pending, 0);
    });
  });

  describe('predicate', () => {
    it('should require a function', () => {
      assert.throws(() => predicate({}), TypeError);
    });

    it('should poll the caller predicate until it holds', async () => {
      let calls = 0;
      const check = predicate({
        name: 'spa-ready',
        intervalMs: 5,
        fn: () => ++calls >= 3,
      });

      const outcome = await runCheck(check);

      assert.strictEqual(outcome.satisfied, true);
      assert.strictEqual(calls, 3);
    });
  });

  describe('runReadinessChecks', () => {
    const ok = (name) => ({ name, run: async () => ({ satisfied: true }) });
    const bad = (name) => ({ name, run: async () => ({ satisfied: false }) });
    const skip = (name) => ({ name, run: async () => ({ skipped: true }) });

    it('should be ready only when nothing failed and nothing is pending', async () => {
      const deadline = createDeadline({ timeout: 1000 });
      const result = await runReadinessChecks({
        checks: [ok('a'), skip('b'), ok('c')],
        deadline,
      });

      assert.strictEqual(result.ready, true);
      assert.strictEqual(result.status, READINESS_STATUS.READY);
      assert.deepStrictEqual(result.checks.satisfied, ['a', 'c']);
      assert.deepStrictEqual(result.checks.skipped, ['b']);
      assert.deepStrictEqual(result.checks.failed, []);
    });

    it('should report failed checks without stopping the whole report', async () => {
      const deadline = createDeadline({ timeout: 1000 });
      const result = await runReadinessChecks({
        checks: [bad('a'), ok('b')],
        deadline,
      });

      assert.strictEqual(result.ready, false);
      assert.strictEqual(result.status, READINESS_STATUS.FAILED);
      assert.deepStrictEqual(result.checks.failed, ['a']);
      assert.deepStrictEqual(result.checks.satisfied, ['b']);
      assert.strictEqual(result.evidence.length, 2);
    });

    it('should turn a thrown check into evidence rather than a crash', async () => {
      const deadline = createDeadline({ timeout: 1000 });
      const result = await runReadinessChecks({
        checks: [
          {
            name: 'boom',
            run: async () => {
              throw new Error('adapter gone');
            },
          },
        ],
        deadline,
      });

      assert.strictEqual(result.ready, false);
      assert.strictEqual(result.evidence[0].detail.error, 'adapter gone');
    });

    it('should mark unreached checks as pending after the deadline', async () => {
      const clock = createFakeClock();
      const deadline = createDeadline({ timeout: 100, now: clock.now });
      const result = await runReadinessChecks({
        checks: [
          {
            name: 'slow',
            run: async () => {
              clock.advance(500);
              return { satisfied: false };
            },
          },
          ok('never-run'),
        ],
        deadline,
      });

      assert.strictEqual(result.status, READINESS_STATUS.TIMED_OUT);
      assert.deepStrictEqual(result.checks.pending, ['never-run']);
      assert.strictEqual(result.ready, false);
    });

    it('should report elapsed and total budget on the result', async () => {
      const clock = createFakeClock();
      const deadline = createDeadline({ timeout: 800, now: clock.now });
      const result = await runReadinessChecks({
        checks: [ok('a')],
        deadline,
      });

      assert.strictEqual(result.timeoutMs, 800);
      assert.strictEqual(typeof result.elapsedMs, 'number');
    });
  });
});
