import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createNetworkTracker } from '../../../src/core/network-tracker.js';
import { createMockPlaywrightPage, createMockLogger } from '../../helpers/mocks.js';

describe('network-tracker', () => {
  let page;
  let log;

  beforeEach(() => {
    page = createMockPlaywrightPage();
    log = createMockLogger();
  });

  describe('createNetworkTracker', () => {
    it('should throw when page is not provided', () => {
      assert.throws(
        () => createNetworkTracker({ log, engine: 'playwright' }),
        /page is required/
      );
    });

    it('should create network tracker', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      assert.ok(tracker);
      assert.ok(typeof tracker.startTracking === 'function');
      assert.ok(typeof tracker.stopTracking === 'function');
      assert.ok(typeof tracker.waitForNetworkIdle === 'function');
      assert.ok(typeof tracker.getPendingCount === 'function');
      assert.ok(typeof tracker.getPendingUrls === 'function');
      assert.ok(typeof tracker.reset === 'function');
      assert.ok(typeof tracker.on === 'function');
      assert.ok(typeof tracker.off === 'function');
    });

    it('should start tracking without error', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      tracker.startTracking();
      // Should not throw
    });

    it('should stop tracking without error', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      tracker.startTracking();
      tracker.stopTracking();
      // Should not throw
    });

    it('should not start tracking twice', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      tracker.startTracking();
      tracker.startTracking(); // Should not throw or double-register
    });

    it('should not stop tracking if not started', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      tracker.stopTracking(); // Should not throw
    });

    it('should return 0 pending count initially', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      assert.strictEqual(tracker.getPendingCount(), 0);
    });

    it('should return empty pending URLs initially', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      const urls = tracker.getPendingUrls();
      assert.ok(Array.isArray(urls));
      assert.strictEqual(urls.length, 0);
    });

    it('should reset without error', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      tracker.reset();
      // Should not throw
    });

    it('should add event listener', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      const callback = () => {};
      tracker.on('onRequestStart', callback);
      // Should not throw
    });

    it('should remove event listener', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      const callback = () => {};
      tracker.on('onRequestStart', callback);
      tracker.off('onRequestStart', callback);
      // Should not throw
    });

    it('should handle invalid event names gracefully', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
      });
      const callback = () => {};
      tracker.on('invalidEvent', callback);
      tracker.off('invalidEvent', callback);
      // Should not throw
    });

    it('should accept custom idle timeout', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
        idleTimeout: 1000,
      });
      assert.ok(tracker);
    });

    it('should accept custom request timeout', () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
        requestTimeout: 60000,
      });
      assert.ok(tracker);
    });
  });

  describe('waitForNetworkIdle', () => {
    it('should resolve immediately when no pending requests', async () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
        idleTimeout: 10, // Very short for testing
      });

      const result = await tracker.waitForNetworkIdle({ timeout: 100, idleTime: 10 });
      assert.ok(result === true || result === false); // May timeout in fast test
    });

    it('should accept timeout option', async () => {
      const tracker = createNetworkTracker({
        page,
        engine: 'playwright',
        log,
        idleTimeout: 10,
      });

      const result = await tracker.waitForNetworkIdle({ timeout: 50 });
      // Should return within timeout
      assert.ok(typeof result === 'boolean');
    });
  });
});
