import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CHROME_ARGS, TIMING } from '../../../src/core/constants.js';

describe('constants', () => {
  describe('CHROME_ARGS', () => {
    it('should be an array', () => {
      assert.ok(Array.isArray(CHROME_ARGS));
    });

    it('should contain expected browser arguments', () => {
      assert.ok(CHROME_ARGS.includes('--disable-infobars'));
      assert.ok(CHROME_ARGS.includes('--no-first-run'));
      assert.ok(CHROME_ARGS.includes('--no-default-browser-check'));
    });

    it('should contain crash-related flags', () => {
      assert.ok(CHROME_ARGS.includes('--disable-session-crashed-bubble'));
      assert.ok(CHROME_ARGS.includes('--hide-crash-restore-bubble'));
      assert.ok(CHROME_ARGS.includes('--disable-crash-restore'));
    });

    it('should have at least 5 arguments', () => {
      assert.ok(CHROME_ARGS.length >= 5);
    });
  });

  describe('TIMING', () => {
    it('should be an object', () => {
      assert.ok(typeof TIMING === 'object');
    });

    it('should have SCROLL_ANIMATION_WAIT property', () => {
      assert.ok(typeof TIMING.SCROLL_ANIMATION_WAIT === 'number');
      assert.ok(TIMING.SCROLL_ANIMATION_WAIT > 0);
    });

    it('should have DEFAULT_WAIT_AFTER_SCROLL property', () => {
      assert.ok(typeof TIMING.DEFAULT_WAIT_AFTER_SCROLL === 'number');
      assert.ok(TIMING.DEFAULT_WAIT_AFTER_SCROLL > 0);
    });

    it('should have VISIBILITY_CHECK_TIMEOUT property', () => {
      assert.ok(typeof TIMING.VISIBILITY_CHECK_TIMEOUT === 'number');
      assert.ok(TIMING.VISIBILITY_CHECK_TIMEOUT > 0);
    });

    it('should have DEFAULT_TIMEOUT property', () => {
      assert.ok(typeof TIMING.DEFAULT_TIMEOUT === 'number');
      assert.ok(TIMING.DEFAULT_TIMEOUT >= 1000);
    });

    it('should have VERIFICATION_TIMEOUT property', () => {
      assert.ok(typeof TIMING.VERIFICATION_TIMEOUT === 'number');
      assert.ok(TIMING.VERIFICATION_TIMEOUT > 0);
    });

    it('should have VERIFICATION_RETRY_INTERVAL property', () => {
      assert.ok(typeof TIMING.VERIFICATION_RETRY_INTERVAL === 'number');
      assert.ok(TIMING.VERIFICATION_RETRY_INTERVAL > 0);
    });

    it('should have reasonable timeout values', () => {
      // Verification retry should be shorter than verification timeout
      assert.ok(TIMING.VERIFICATION_RETRY_INTERVAL < TIMING.VERIFICATION_TIMEOUT);
      // Scroll animation wait should be relatively short
      assert.ok(TIMING.SCROLL_ANIMATION_WAIT < 1000);
    });
  });
});
