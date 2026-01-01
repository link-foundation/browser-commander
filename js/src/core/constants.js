/**
 * Common Chrome arguments used across both Playwright and Puppeteer
 */
export const CHROME_ARGS = [
  '--disable-session-crashed-bubble',
  '--hide-crash-restore-bubble',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-crash-restore',
];

/**
 * Timing constants for browser operations
 */
export const TIMING = {
  SCROLL_ANIMATION_WAIT: 300, // Wait time for scroll animations to complete
  DEFAULT_WAIT_AFTER_SCROLL: 1000, // Default wait after scrolling to element
  VISIBILITY_CHECK_TIMEOUT: 100, // Timeout for quick visibility checks
  DEFAULT_TIMEOUT: 5000, // Default timeout for most operations
  NAVIGATION_TIMEOUT: 30000, // Default timeout for navigation operations
  VERIFICATION_TIMEOUT: 3000, // Default timeout for action verification
  VERIFICATION_RETRY_INTERVAL: 100, // Interval between verification retries
};
