import makeLog from 'log-lazy';

/**
 * Check if verbose logging is enabled via environment or CLI args
 * @returns {boolean} - True if verbose mode is enabled
 */
export function isVerboseEnabled() {
  return !!(process.env.VERBOSE || process.argv.includes('--verbose'));
}

/**
 * Create a logger instance with verbose level control
 * @param {Object} options - Configuration options
 * @param {boolean} options.verbose - Enable verbose logging
 * @returns {Object} - Logger instance
 */
export function createLogger(options = {}) {
  const { verbose = false } = options;
  const log = makeLog({ level: verbose ? 'debug' : 'error' });
  return log;
}
