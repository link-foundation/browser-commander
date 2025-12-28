import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { isVerboseEnabled, createLogger } from '../../../src/core/logger.js';

describe('logger', () => {
  let originalEnv;
  let originalArgv;

  beforeEach(() => {
    originalEnv = process.env.VERBOSE;
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.VERBOSE = originalEnv;
    } else {
      delete process.env.VERBOSE;
    }
    process.argv = originalArgv;
  });

  describe('isVerboseEnabled', () => {
    it('should return false when VERBOSE env is not set', () => {
      delete process.env.VERBOSE;
      // Filter out --verbose from argv if present
      process.argv = process.argv.filter((arg) => arg !== '--verbose');
      assert.strictEqual(isVerboseEnabled(), false);
    });

    it('should return true when VERBOSE env is set', () => {
      process.env.VERBOSE = 'true';
      assert.strictEqual(isVerboseEnabled(), true);
    });

    it('should return true when VERBOSE env is set to any value', () => {
      process.env.VERBOSE = '1';
      assert.strictEqual(isVerboseEnabled(), true);
    });

    it('should return true when --verbose flag is in argv', () => {
      delete process.env.VERBOSE;
      process.argv = ['node', 'script.js', '--verbose'];
      assert.strictEqual(isVerboseEnabled(), true);
    });
  });

  describe('createLogger', () => {
    it('should create a logger instance', () => {
      const log = createLogger();
      assert.ok(log);
      assert.ok(typeof log === 'function' || typeof log === 'object');
    });

    it('should create logger with verbose disabled by default', () => {
      const log = createLogger();
      assert.ok(log);
    });

    it('should create logger with verbose enabled', () => {
      const log = createLogger({ verbose: true });
      assert.ok(log);
    });

    it('should create logger with verbose disabled', () => {
      const log = createLogger({ verbose: false });
      assert.ok(log);
    });

    it('should handle empty options', () => {
      const log = createLogger({});
      assert.ok(log);
    });

    it('should have debug method', () => {
      const log = createLogger({ verbose: true });
      assert.ok(typeof log.debug === 'function');
    });
  });
});
